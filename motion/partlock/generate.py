"""Offline generation to a file.

    python generate.py --sec 4 --out motion.npz "walk" "Wave" "run/jog" "jump"

Each prompt is used for --sec seconds, in order, in ONE continuous motion (the context is never reset).
Output .npz (30 fps):
    positions  (T, 22, 3)     world joint positions in meters (y up), SMPL joint order
    rotations  (T, 22, 3, 3)  world joint rotations
    root_xz    (T, 2)         pelvis path on the floor
    prompt     (T,)           prompt used for each frame
    parents    (22,)          skeleton parents
"""
import os, sys, argparse
import numpy as np, torch
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "live"))
import live_server as L          # loads the models (GPU)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prompts", nargs="+")
    ap.add_argument("--sec", type=float, default=6.0, help="seconds per prompt")
    ap.add_argument("--s", type=float, default=4.0, help="text strength (classifier-free guidance)")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", default="motion.npz")
    a = ap.parse_args()
    L.ENG = L.Engine()
    torch.manual_seed(a.seed)
    w = L.reset_world()
    steps = max(1, int(round(a.sec * 30 / 4)))
    P, R, T, txt = [], [], [], []
    for p in a.prompts:
        cond = L.embed(L.tok, L.clip, [p]).float()
        for _ in range(steps):
            for f in L.one_step(w, cond, a.s):
                rel = np.array(f["p"], np.float32).reshape(22, 3)
                rel[:, 0] += f["tr"][0]; rel[:, 2] += f["tr"][1]
                P.append(rel); R.append(np.array(f["r"], np.float32).reshape(22, 3, 3)); T.append(f["tr"]); txt.append(p)
    np.savez_compressed(a.out, positions=np.stack(P), rotations=np.stack(R), root_xz=np.array(T, np.float32),
                        prompt=np.array(txt), parents=np.array(L.B.PARENTS), fps=30)
    print("saved %s: %d frames (%.1f s)" % (a.out, len(P), len(P) / 30))


if __name__ == "__main__":
    main()
