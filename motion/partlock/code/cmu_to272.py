"""CMU ASF/AMC -> 272-dim representation (same layout as the HumanML3D-272 data used before).

Layout (as read by tvq272.py / gen_sample.py recovery):
  [0:2]    root xz velocity in the heading frame of the previous frame (frame 0: 0)
  [2:8]    heading change, 6D (first two rows): Rd_0 = H_0, Rd_t = H_t H_{t-1}^T
  [8:74]   joint positions, heading removed, root xz at origin (22x3)
  [74:140] joint velocities in the current heading frame (22x3)
  [140:272] parent-relative rotations 6D (first two rows); root = H_t G_root
Body sizes are kept as captured (the HumanML3D-272 data was not size-normalised either).
Every clip is also mirrored (left/right swapped, caption words left/right swapped).
30 fps. Floor: lowest joint of the clip at y = 0.

usage: python cmu_to272.py <all_asfamc dir> <cmu_files.csv> <out h272 dir>
"""
import os, sys, csv, re, json, math
import numpy as np

SCALE = (1.0 / 0.45) * 2.54 / 100.0          # CMU FAQ
J22 = ["pelvis", "l_hip", "r_hip", "spine1", "l_knee", "r_knee", "spine2", "l_ankle", "r_ankle", "spine3",
       "l_foot", "r_foot", "neck", "l_collar", "r_collar", "head", "l_shoulder", "r_shoulder", "l_elbow",
       "r_elbow", "l_wrist", "r_wrist"]
PAR = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19]
# position of each of the 22 joints = end point of this CMU bone (root = root position)
POS = {0: "root", 1: "lhipjoint", 2: "rhipjoint", 3: "lowerback", 4: "lfemur", 5: "rfemur", 6: "upperback",
       7: "ltibia", 8: "rtibia", 9: "thorax", 10: "lfoot", 11: "rfoot", 12: "lowerneck", 15: "upperneck",
       16: "lclavicle", 17: "rclavicle", 18: "lhumerus", 19: "rhumerus", 20: "lradius", 21: "rradius"}
# collars (13, 14): 35% of the way from thorax end to clavicle end
# rotation of each joint = global orientation of the CMU bone that leaves it towards its main child
ROT = {0: "root", 1: "lfemur", 2: "rfemur", 3: "upperback", 4: "ltibia", 5: "rtibia", 6: "thorax",
       7: "lfoot", 8: "rfoot", 9: "lowerneck", 10: "ltoes", 11: "rtoes", 12: "upperneck", 13: "lclavicle",
       14: "rclavicle", 15: "head", 16: "lhumerus", 17: "rhumerus", 18: "lradius", 19: "rradius",
       20: "lhand", 21: "rhand"}
LR = [(1, 2), (4, 5), (7, 8), (10, 11), (13, 14), (16, 17), (18, 19), (20, 21)]


# ------------------------------------------------------------------ rotations
def rx(a):
    c, s = np.cos(a), np.sin(a); o, z = np.ones_like(a), np.zeros_like(a)
    return np.stack([np.stack([o, z, z], -1), np.stack([z, c, -s], -1), np.stack([z, s, c], -1)], -2)


def ry(a):
    c, s = np.cos(a), np.sin(a); o, z = np.ones_like(a), np.zeros_like(a)
    return np.stack([np.stack([c, z, s], -1), np.stack([z, o, z], -1), np.stack([-s, z, c], -1)], -2)


def rz(a):
    c, s = np.cos(a), np.sin(a); o, z = np.ones_like(a), np.zeros_like(a)
    return np.stack([np.stack([c, -s, z], -1), np.stack([s, c, z], -1), np.stack([z, z, o], -1)], -2)


def euler_xyz(x, y, z):           # rotate about X, then Y, then Z  ->  Rz Ry Rx (degrees in)
    return rz(np.radians(z)) @ ry(np.radians(y)) @ rx(np.radians(x))


# ------------------------------------------------------------------ ASF / AMC
def parse_asf(path):
    lines = [l.strip() for l in open(path, encoding="latin-1")]
    bones, hier, root_order, i = {}, {}, ["tx", "ty", "tz", "rx", "ry", "rz"], 0
    root_axis = "XYZ"
    while i < len(lines):
        l = lines[i]
        if l.startswith(":root"):
            i += 1
            while not lines[i].startswith(":"):
                t = lines[i].split()
                if t and t[0] == "order": root_order = [x.lower() for x in t[1:]]
                if t and t[0] == "axis": root_axis = t[1]
                i += 1
            continue
        if l.startswith(":bonedata"):
            i += 1
            while not lines[i].startswith(":"):
                if lines[i] == "begin":
                    b = dict(dof=[])
                    i += 1
                    while lines[i] != "end":
                        t = lines[i].split()
                        if t[0] == "name": b["name"] = t[1]
                        elif t[0] == "direction": b["dir"] = np.array(list(map(float, t[1:4])))
                        elif t[0] == "length": b["length"] = float(t[1]) * SCALE
                        elif t[0] == "axis":
                            assert t[4] == "XYZ", t
                            b["axis"] = np.array(list(map(float, t[1:4])))
                        elif t[0] == "dof": b["dof"] = [x.lower() for x in t[1:]]
                        i += 1
                    bones[b["name"]] = b
                i += 1
            continue
        if l.startswith(":hierarchy"):
            i += 1
            while i < len(lines) and lines[i] != "end":
                t = lines[i].split()
                if t and t[0] != "begin":
                    for ch in t[1:]: hier[ch] = t[0]
                i += 1
            continue
        i += 1
    assert root_axis == "XYZ"
    order = ["root"]
    k = 0
    while k < len(order):
        order += [c for c, p in hier.items() if p == order[k]]
        k += 1
    for b in bones.values():
        b["C"] = euler_xyz(*b["axis"])
    return bones, hier, order, root_order


def parse_amc(path):
    frames, cur = [], None
    for l in open(path, encoding="latin-1"):
        l = l.strip()
        if not l or l[0] in "#:": continue
        if l.isdigit():
            cur = {}; frames.append(cur); continue
        t = l.split()
        cur[t[0]] = [float(v) for v in t[1:]]
    return frames


def fk(bones, hier, order, root_order, frames):
    """vectorised over frames -> global rotation M[name] (T,3,3) and end point E[name] (T,3), meters"""
    T = len(frames)
    rv = np.array([f["root"] for f in frames])
    d = {k: rv[:, i] for i, k in enumerate(root_order)}
    M, E = {}, {}
    M["root"] = euler_xyz(d["rx"], d["ry"], d["rz"])            # root axis = 0 0 0 -> C = I
    E["root"] = np.stack([d["tx"], d["ty"], d["tz"]], -1) * SCALE
    for n in order[1:]:
        b, p = bones[n], hier[n]
        ang = {"rx": np.zeros(T), "ry": np.zeros(T), "rz": np.zeros(T)}
        if b["dof"]:
            v = np.array([f.get(n, [0.0] * len(b["dof"])) for f in frames])
            for k, dof in enumerate(b["dof"]):
                ang[dof] = v[:, k]
        L = euler_xyz(ang["rx"], ang["ry"], ang["rz"])
        M[n] = M[p] @ b["C"] @ L @ b["C"].T
        E[n] = E[p] + b["length"] * (M[n] @ b["dir"])
    return M, E


def to22(M, E):
    P = np.zeros((len(E["root"]), 22, 3))
    for j, n in POS.items():
        P[:, j] = E[n]
    P[:, 13] = E["thorax"] + 0.35 * (E["lclavicle"] - E["thorax"])
    P[:, 14] = E["thorax"] + 0.35 * (E["rclavicle"] - E["thorax"])
    G = np.stack([M[ROT[j]] for j in range(22)], 1)          # (T,22,3,3)
    return P, G


def mirror(P, G):
    S = np.diag([-1.0, 1.0, 1.0])
    P2, G2 = P * np.array([-1.0, 1.0, 1.0]), S @ G @ S
    for a, b in LR:
        P2[:, [a, b]] = P2[:, [b, a]]
        G2[:, [a, b]] = G2[:, [b, a]]
    return P2, G2


# ------------------------------------------------------------------ 272 features
def six(R):                         # first two ROWS
    return R[..., :2, :].reshape(*R.shape[:-2], 6)


def features(P, G):
    P = P.copy()
    P[..., 1] -= P[..., 1].min()                             # floor
    P[..., [0, 2]] -= P[0, 0, [0, 2]]                        # start at origin
    T = P.shape[0]
    f = G[:, 0] @ np.array([0.0, 0.0, 1.0])                  # body forward
    a = np.arctan2(f[:, 0], f[:, 2])
    H = np.transpose(ry(a), (0, 2, 1))                       # world -> heading frame
    r = P[:, 0].copy(); r[:, 1] = 0
    loc = np.einsum("tij,tkj->tki", H, P - r[:, None])
    dP = np.zeros_like(P); dP[1:] = P[1:] - P[:-1]; dP[0] = dP[1] if T > 1 else 0
    vel = np.einsum("tij,tkj->tki", H, dP)
    rv = np.zeros((T, 3))
    rv[1:] = np.einsum("tij,tj->ti", H[:-1], r[1:] - r[:-1])
    Rd = np.empty_like(H); Rd[0] = H[0]; Rd[1:] = H[1:] @ np.transpose(H[:-1], (0, 2, 1))
    R = np.empty_like(G)
    R[:, 0] = H @ G[:, 0]
    for j in range(1, 22):
        R[:, j] = np.transpose(G[:, PAR[j]], (0, 2, 1)) @ G[:, j]
    x = np.concatenate([rv[:, [0, 2]], six(Rd), loc.reshape(T, -1), vel.reshape(T, -1),
                        six(R).reshape(T, -1)], 1)
    assert x.shape[1] == 272
    return x.astype(np.float32), P, G


def recover(x):
    """numpy copy of gen_sample.py recovery -> world positions (T,22,3), global rotations"""
    def mat(s):
        a1, a2 = s[..., :3], s[..., 3:]
        b1 = a1 / np.linalg.norm(a1, axis=-1, keepdims=True)
        b2 = a2 - (b1 * a2).sum(-1, keepdims=True) * b1
        b2 /= np.linalg.norm(b2, axis=-1, keepdims=True)
        return np.stack([b1, b2, np.cross(b1, b2)], -2)
    T = x.shape[0]
    Rd = mat(x[:, 2:8])
    tot = [Rd[0]]
    for t in range(1, T):
        tot.append(Rd[t] @ tot[-1])
    inv = np.transpose(np.stack(tot), (0, 2, 1))
    Pl = x[:, 8:74].reshape(T, 22, 3)
    Pw = np.einsum("tij,tkj->tki", inv, Pl)
    v = np.zeros((T, 3)); v[:, 0], v[:, 2] = x[:, 0], x[:, 1]
    v[1:] = np.einsum("tij,tj->ti", inv[:-1], v[1:])
    tr = np.cumsum(v, 0)
    Pw[..., 0] += tr[:, None, 0]; Pw[..., 2] += tr[:, None, 2]
    Rl = mat(x[:, 140:272].reshape(T, 22, 6))
    Rl[:, 0] = inv @ Rl[:, 0]
    Gr = [None] * 22
    for j in range(22):
        Gr[j] = Rl[:, j] if PAR[j] < 0 else Gr[PAR[j]] @ Rl[:, j]
    return Pw, np.stack(Gr, 1)


# ------------------------------------------------------------------ captions
def clean_caption(s):
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s.strip())       # CarefulWalk -> Careful Walk
    s = re.sub(r"\s+", " ", s).strip()
    return s


def mirror_caption(s):
    tmp = re.sub(r"\bleft\b", "\0L", s, flags=re.I)
    tmp = re.sub(r"\bright\b", "left", tmp, flags=re.I)
    tmp = tmp.replace("\0L", "right")
    tmp = re.sub(r"\bcounter[- ]?clockwise\b", "\0CC", tmp, flags=re.I)
    tmp = re.sub(r"\bclockwise\b", "counterclockwise", tmp, flags=re.I)
    return tmp.replace("\0CC", "clockwise")


# ------------------------------------------------------------------ main
def main():
    src, files_csv, out = sys.argv[1], sys.argv[2], sys.argv[3]
    meta = list(csv.DictReader(open(files_csv, encoding="utf-8-sig")))
    mdir = os.path.join(out, "motion_data", "cmu"); tdir = os.path.join(out, "texts", "texts")
    for d in (mdir, tdir, os.path.join(out, "split"), os.path.join(out, "mean_std")):
        os.makedirs(d, exist_ok=True)
    report, kept, asf_cache = [], [], {}
    for k, r in enumerate(meta):
        key, desc = r["file"], r["desc"].strip()
        rec = dict(file=key, desc=desc)
        if desc == "(一覧になし)":
            rec["skip"] = "not in CMU list (fps unknown)"; report.append(rec); continue
        fps = int(r["fps"]); step = fps // 30
        if fps % 30:
            rec["skip"] = "fps %d" % fps; report.append(rec); continue
        subj = key.split("_")[0]
        try:
            if subj not in asf_cache:
                asf_cache[subj] = parse_asf(os.path.join(src, "subjects", subj, subj + ".asf"))
            bones, hier, order, ro = asf_cache[subj]
            frames = parse_amc(os.path.join(src, "subjects", subj, key + ".amc"))[::step]
            if len(frames) < 16:
                rec["skip"] = "too short (%d frames)" % len(frames); report.append(rec); continue
            M, E = fk(bones, hier, order, ro, frames)
            P, G = to22(M, E)
        except Exception as e:                                   # noqa
            rec["skip"] = "error: %r" % e; report.append(rec); continue
        T = P.shape[0]
        sp = np.linalg.norm(np.diff(P, axis=0), axis=-1) * 30    # m/s
        rec.update(frames=T, sec=round(T / 30, 2), max_joint_speed=round(float(sp.max()), 2),
                   pelvis_h_median=round(float(np.median(P[:, 0, 1] - P[..., 1].min())), 3))
        flags = []
        if not np.isfinite(P).all() or not np.isfinite(G).all():
            flags.append("nan")
        if sp.max() > 20:
            flags.append("speed>20m/s")
        caption = "" if desc.lower() in ("", "clean") else clean_caption(desc)
        for tag, (PP, GG), cap in (("c", (P, G), caption), ("Mc", mirror(P, G), mirror_caption(caption))):
            x, Pn, Gn = features(PP, GG)
            Pr, Gr = recover(x)
            err = float(np.abs(Pr - Pn).max()) * 1000
            gerr = float(np.abs(Gr - Gn).max())
            if tag == "c":
                rec.update(recover_err_mm=round(err, 4), recover_rot_err=round(gerr, 6))
            if err > 1.0 or gerr > 1e-4:
                flags.append("recover %s %.3fmm %.1e" % (tag, err, gerr))
            if flags:
                continue
            np.save(os.path.join(mdir, tag + key + ".npy"), x)
            if cap:
                with open(os.path.join(tdir, tag + key + ".txt"), "w", encoding="utf-8") as f:
                    f.write("%s#%s#0.0#0.0\n" % (cap, cap.lower()))
        rec["flags"] = flags
        if not flags:
            kept.append(key)
        report.append(rec)
        if (k + 1) % 200 == 0:
            print("%d / %d" % (k + 1, len(meta)), flush=True)
    # split by original clip (mirror follows), 90/5/5
    rng = np.random.default_rng(0)
    ids = sorted(kept); rng.shuffle(ids)
    n = len(ids); nv = nt = max(1, round(n * 0.05))
    sp = {"val": ids[:nv], "test": ids[nv:nv + nt], "train": ids[nv + nt:]}
    for name, lst in sp.items():
        with open(os.path.join(out, "split", name + ".txt"), "w") as f:
            f.write("\n".join(t + i for i in lst for t in ("c", "Mc")) + "\n")
    # mean / std on train
    s1 = np.zeros(272); s2 = np.zeros(272); cnt = 0
    for i in sp["train"]:
        for t in ("c", "Mc"):
            x = np.load(os.path.join(mdir, t + i + ".npy")).astype(np.float64)
            s1 += x.sum(0); s2 += (x ** 2).sum(0); cnt += x.shape[0]
    mean = s1 / cnt; std = np.sqrt(np.maximum(s2 / cnt - mean ** 2, 0))
    np.save(os.path.join(out, "mean_std", "Mean.npy"), mean.astype(np.float32))
    np.save(os.path.join(out, "mean_std", "Std.npy"), np.maximum(std, 1e-3).astype(np.float32))
    json.dump(report, open(os.path.join(out, "convert_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    flagged = [r for r in report if r.get("flags")]
    skipped = [r for r in report if r.get("skip")]
    sec = sum(r["sec"] for r in report if r.get("flags") == [])
    print("kept %d clips (%.2f h, x2 with mirror) | flagged %d | skipped %d | split train %d val %d test %d"
          % (len(kept), sec / 3600, len(flagged), len(skipped), len(sp["train"]), len(sp["val"]), len(sp["test"])))
    print("recover err max mm:", max(r.get("recover_err_mm", 0) for r in report))
    print("std floor hit dims:", int((std < 1e-3).sum()))
    for r in flagged[:20]:
        print("  FLAG", r["file"], r["flags"], r["desc"][:50])
    from collections import Counter
    print("skip reasons:", Counter(r["skip"].split(" (")[0].split(":")[0] for r in skipped))


if __name__ == "__main__":
    main()
