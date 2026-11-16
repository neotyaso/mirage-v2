"""Real-time, endless text-to-motion with the PartLock CMU model.
The model keeps generating forever; the browser plays it in real time.
Typing a prompt and pressing the button swaps the text at the next step (4 frames), without resetting the context.

    python live/live_server.py          then open http://localhost:8765

Options (environment variables): LIVE_PORT (8765), LIVE_LEAD (6 steps generated ahead of playback = 0.8 s).
Generation is kept only LEAD steps ahead of playback, so a new prompt shows up after about LEAD*4/30 s."""
import os, sys, json, time, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import numpy as np, torch
import torch.nn.functional as F
from safetensors.torch import load_file
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO, "code"))
import tvq272 as B, tvq272c as C, gen_ar as G
from gen_sample import load, embed, get_codebook

dev = "cuda"
WTS = os.path.join(REPO, "weights")
PORT = int(os.environ.get("LIVE_PORT", "8765"))
LEAD = int(os.environ.get("LIVE_LEAD", "6"))     # steps generated ahead of playback (6 steps = 0.8 s)
DEC_CTX = 32                                      # decoder receptive field is ~16 steps; 32 is safe
KEEP = 30 * 120                                   # frames kept on the server (2 min)

mean = torch.from_numpy(np.load(os.path.join(WTS, "Mean.npy")).astype(np.float32)).to(dev)
std = torch.from_numpy(np.load(os.path.join(WTS, "Std.npy")).astype(np.float32)).to(dev)
h = C.CHierTok().to(dev); h.load_state_dict(load_file(os.path.join(WTS, "tokenizer.safetensors"), device=dev)); h.eval()
g = G.Gen().to(dev); g.load_state_dict(load_file(os.path.join(WTS, "generator.safetensors"), device=dev)); g.eval()
tok, clip = load()
CB = [get_codebook(h.gvq)] + [get_codebook(v) for v in h.vq]
OFFT = torch.tensor(G.OFF, device=dev)
SLOTS = torch.arange(G.L, device=dev) % 7


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.frames = []          # list of dict per frame (json-ready)
        self.base = 0             # global index of frames[0]
        self.total = 0            # frames produced so far
        self.play = 0             # browser playback frame (reported by polling)
        self.prompt = "Standing still"
        self.pending = None
        self.reset = False
        self.s = 4.0
        self.step_ms = 0.0
        self.log = []             # (frame, prompt)


S = State()


def reset_world():
    return dict(codes=torch.zeros(0, 7, dtype=torch.long, device=dev), toks=torch.zeros(1, 0, dtype=torch.long, device=dev),
                tot=None, inv_prev=None, tr=torch.zeros(3, dtype=torch.float64))


def _attn_in(b, x, pos):
    Bn, T, D = x.shape
    q, k, v = b.qkv(b.n1(x)).view(Bn, T, 3, b.h, D // b.h).permute(2, 0, 3, 1, 4)
    return G.rope(q, pos), G.rope(k, pos), v


def _attn_out(b, x, a):
    Bn, T, D = x.shape
    x = x + b.o(a.transpose(1, 2).reshape(Bn, T, D))
    return x + b.ff(b.n2(x))


LMAX = G.L        # 448 = BOS + 63 past steps + 7 tokens of the current step (most the original ever feeds)


class Engine:
    """CUDA-graph version of the same forward. Static K/V buffers of length LMAX.
    full(): window padded to LMAX at the END (causal -> real positions are unaffected), logits taken at T-1.
    one(): one new token at position p, attends to positions <= p."""
    def __init__(self):
        nh = g.blocks[0].h; dh = 512 // nh
        self.K = [torch.zeros(2, nh, LMAX, dh, device=dev, dtype=torch.bfloat16) for _ in g.blocks]
        self.V = [torch.zeros_like(k) for k in self.K]
        self.ids = torch.full((2, LMAX), G.NV, device=dev, dtype=torch.long)
        self.tc = torch.zeros(2, 1, 512, device=dev)
        self.last = torch.zeros((), device=dev, dtype=torch.long)       # index T-1
        self.tid = torch.zeros(2, 1, device=dev, dtype=torch.long)
        self.p = torch.zeros(1, device=dev, dtype=torch.long)
        self.ar = torch.arange(LMAX, device=dev)
        s = torch.cuda.Stream(); s.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(s):
            for _ in range(3):
                self._full(); self._one()
        torch.cuda.current_stream().wait_stream(s)
        self.gf = torch.cuda.CUDAGraph()
        with torch.cuda.graph(self.gf):
            self.out_f = self._full()
        self.go = torch.cuda.CUDAGraph()
        with torch.cuda.graph(self.go):
            self.out_o = self._one()

    @torch.no_grad()
    def _full(self):
        with torch.autocast("cuda", dtype=torch.bfloat16):
            x = g.tok(self.ids) + g.slot(SLOTS)[None] + g.txt(self.tc)
            pos = self.ar
            for b, K, V in zip(g.blocks, self.K, self.V):
                q, k, v = _attn_in(b, x, pos)
                K.copy_(k); V.copy_(v)
                x = _attn_out(b, x, F.scaled_dot_product_attention(q, k, v, is_causal=True))
            xl = x.index_select(1, self.last.view(1))
            return (g.head(g.nf(xl)) + g.mask[SLOTS.index_select(0, self.last.view(1))][None]).float()[:, 0]

    @torch.no_grad()
    def _one(self):
        with torch.autocast("cuda", dtype=torch.bfloat16):
            sl = SLOTS.index_select(0, self.p)
            x = g.tok(self.tid) + g.slot(sl)[None] + g.txt(self.tc)
            msk = (self.ar <= self.p)[None, None, None]            # (1,1,1,LMAX)
            for b, K, V in zip(g.blocks, self.K, self.V):
                q, k, v = _attn_in(b, x, self.p)
                K.index_copy_(2, self.p, k.to(K.dtype)); V.index_copy_(2, self.p, v.to(V.dtype))
                x = _attn_out(b, x, F.scaled_dot_product_attention(q, K, V, attn_mask=msk))
            return (g.head(g.nf(x)) + g.mask[sl][None]).float()[:, 0]

    def full(self, inp, tc):
        T = inp.shape[1]
        self.ids.fill_(G.NV); self.ids[:, :T] = inp; self.tc.copy_(tc); self.last.fill_(T - 1)
        self.gf.replay(); return self.out_f.clone()

    def one(self, tid, p):
        self.tid.copy_(tid); self.p.fill_(p)
        self.go.replay(); return self.out_o.clone()


ENG = None


@torch.no_grad()
def one_step(w, cond, s, check=False):
    """generate the 7 tokens of one step (CFG), decode its 4 frames, integrate world pose."""
    unc = g.null[None]
    cur = w["toks"].shape[1] // 7
    first = max(0, cur - (G.S - 1)) * 7
    inp = torch.cat([torch.full((1, 1), G.NV, device=dev, dtype=torch.long), w["toks"][:, first:]], 1)
    T = inp.shape[1]
    tc = torch.cat([cond, unc])[:, None, :]
    diffs = []
    for k in range(7):
        if ENG is not None:
            lo = ENG.full(torch.cat([inp, inp]), tc) if k == 0 else ENG.one(torch.cat([nxt, nxt]), T + k - 1)
        else:
            with torch.autocast("cuda", dtype=torch.bfloat16):
                lo = g(torch.cat([inp, inp]), SLOTS[:T], tc.expand(-1, T, -1))[:, -1].float() if k == 0 else None
                if k:
                    full = torch.cat([inp, w["toks"][:, w["toks"].shape[1] - k:]], 1)
                    lo = g(torch.cat([full, full]), SLOTS[:full.shape[1]], tc.expand(-1, full.shape[1], -1))[:, -1].float()
        if check:   # compare with the original full forward (valid entries only)
            with torch.autocast("cuda", dtype=torch.bfloat16):
                full = torch.cat([inp, w["toks"][:, w["toks"].shape[1] - k:]], 1) if k else inp
                ref = g(torch.cat([full, full]), SLOTS[:full.shape[1]], tc.expand(-1, full.shape[1], -1))[:, -1].float()
            vv = g.mask[k] == 0
            diffs.append(float((ref[:, vv] - lo[:, vv]).abs().max()))
        lo = lo.float()
        lc, lu = lo[:1], lo[1:]
        valid = (g.mask[k] == 0)[None]
        lc = torch.where(valid, lc, torch.zeros_like(lc)); lu = torch.where(valid, lu, torch.zeros_like(lu))
        lg = torch.where(valid, (1 + s) * lc - s * lu, torch.full_like(lc, float("-inf")))
        nxt = torch.multinomial(F.softmax(lg, -1), 1)
        w["toks"] = torch.cat([w["toks"], nxt], 1)
    if check:
        w["diffs"] = diffs
    w["toks"] = w["toks"][:, -G.S * 7:]                      # only the window is ever used
    code = w["toks"][0, -7:] - OFFT
    w["codes"] = torch.cat([w["codes"], code[None]])[-DEC_CTX:]
    # causal decode of the last DEC_CTX steps, keep the newest 4 frames
    c = w["codes"][None]
    qg = CB[0][c[..., 0]].permute(0, 2, 1)
    y = torch.zeros(1, c.shape[1] * 4, 272, device=dev)
    for p, dims in enumerate(B.PD):
        q = CB[p + 1][c[..., p + 1]].permute(0, 2, 1)
        y[..., dims] = h.dec[p](torch.cat([qg, q], 1)).permute(0, 2, 1)
    x = (y * std + mean)[0, -4:].double().cpu()               # (4,272) -> small 3x3 math on the CPU
    Rd = B.rot6d_to_mat(x[:, 2:8])
    P = B.positions(x)
    Rl = B.local_rots(x).clone()
    out = []
    for t in range(4):
        w["tot"] = Rd[t] if w["tot"] is None else Rd[t] @ w["tot"]
        U, _, Vh = torch.linalg.svd(w["tot"]); w["tot"] = U @ Vh  # keep it a rotation forever
        inv = w["tot"].T
        v = torch.tensor([float(x[t, 0]), 0.0, float(x[t, 1])], dtype=torch.float64)
        if w["inv_prev"] is not None:
            v = w["inv_prev"] @ v
        w["tr"] = w["tr"] + v
        w["inv_prev"] = inv
        Pw = (inv @ P[t].T).T                                 # pelvis-relative in x/z, absolute y
        Rl[t, 0] = inv @ Rl[t, 0]
        out.append((Pw, w["tr"].clone()))
    Gw = B.global_rots(Rl)                                    # (4,22,3,3)
    frames = []
    for t in range(4):
        Pw, tr = out[t]
        frames.append(dict(p=np.round(Pw.numpy().ravel(), 3).tolist(),
                           r=np.round(Gw[t].numpy().ravel(), 3).tolist(),
                           tr=[round(float(tr[0]), 3), round(float(tr[2]), 3)]))
    return frames


def gen_loop():
    w = reset_world()
    cond = embed(tok, clip, [S.prompt]).float()
    torch.manual_seed(1)
    while True:
        with S.lock:
            if S.reset:
                S.reset = False; w = reset_world()
            if S.pending is not None:
                S.prompt, S.pending = S.pending, None
                new = S.prompt
            else:
                new = None
            ahead = S.total - S.play
            s = S.s
        if new is not None:
            cond = embed(tok, clip, [new]).float()
            with S.lock:
                S.log.append([S.total, new]); S.log = S.log[-50:]
        if ahead >= LEAD * 4:
            time.sleep(0.01); continue
        t0 = time.time()
        fr = one_step(w, cond, s)
        dt = (time.time() - t0) * 1000
        with S.lock:
            S.step_ms = dt if S.step_ms == 0 else 0.9 * S.step_ms + 0.1 * dt
            for f in fr:
                f["text"] = S.prompt
            S.frames.extend(fr); S.total += 4
            if len(S.frames) > KEEP:
                cut = len(S.frames) - KEEP; S.frames = S.frames[cut:]; S.base += cut


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json; charset=utf-8"):
        b = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code); self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store"); self.send_header("Content-Length", str(len(b)))
        self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path in ("/", "/index.html"):
            return self.send(200, open(os.path.join(HERE, "live.html"), encoding="utf-8").read(), "text/html; charset=utf-8")
        if u.path == "/frames":
            frm = int(q.get("from", ["0"])[0]); play = int(q.get("play", ["0"])[0])
            with S.lock:
                if frm < 0:                                   # a page just opened: start at the newest frames
                    frm = max(S.base, S.total - 8)
                    S.play = frm
                else:
                    S.play = max(S.play, min(play, S.total))
                if frm < S.base:
                    frm = S.base
                fr = S.frames[frm - S.base:]
                body = json.dumps(dict(start=frm, frames=fr, total=S.total, prompt=S.prompt, pending=S.pending,
                                       step_ms=round(S.step_ms, 1), realtime_ms=round(4000 / 30, 1), s=S.s,
                                       lead=LEAD, log=S.log[-8:]), separators=(",", ":"))
            return self.send(200, body)
        self.send(404, "{}")

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get("Content-Length", "0") or 0)
        d = json.loads(self.rfile.read(n) or b"{}")
        with S.lock:
            if u.path == "/prompt":
                t = str(d.get("text", "")).strip()[:300]
                if t:
                    S.pending = t
            elif u.path == "/reset":
                S.reset = True
                S.frames, S.base, S.total, S.play, S.log = [], 0, 0, 0, []
            elif u.path == "/s":
                S.s = float(max(0.0, min(10.0, float(d.get("s", 4.0)))))
            else:
                return self.send(404, "{}")
        self.send(200, '{"ok":true}')


if __name__ == "__main__":
    # build the CUDA graphs, then an exactness check (bf16 rounding only) and a speed check
    ENG = Engine()
    w = reset_world(); cond = embed(tok, clip, ["walk"]).float()
    for _ in range(3):
        one_step(w, cond, 4.0, check=True)
        print("graph vs original forward, max |logit diff| per token:", ["%.3f" % v for v in w["diffs"]], flush=True)
    torch.cuda.synchronize(); t0 = time.time()
    for _ in range(70):                                       # fills the full 64-step window
        one_step(w, cond, 4.0)
    torch.cuda.synchronize()
    ms = (time.time() - t0) * 1000 / 70
    print("1 step (4 frames) = %.1f ms ; real time needs <= %.1f ms" % (ms, 4000 / 30), flush=True)
    for _ in range(2):                                        # window already sliding here
        one_step(w, cond, 4.0, check=True)
        print("graph vs original forward (sliding window):", ["%.3f" % v for v in w["diffs"]], flush=True)
    threading.Thread(target=gen_loop, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    print("open http://localhost:%d" % PORT, flush=True)
    srv.serve_forever()
