"""FloodDiffusion の 22 関節の位置を、VRM の正規化ボーンの回転に直す。

出力は scripts/fbx2motion.mjs と同じ形式 {duration, tracks}。フロントエンドの toClip でそのまま再生できる。
座標は Y が上、キャラクターは +Z を向き、左手が +X（HumanML3D と VRM 1.0 の正規化ボーンで共通）。
クォータニオンは three.js と同じ (x, y, z, w) の順。
"""

import numpy as np

FPS = 30  # PartLock-CMU の出力は 30fps（HumanML3D の 20fps ではない）

# HumanML3D（SMPL）の 22 関節の並び
(PELVIS, L_HIP, R_HIP, SPINE1, L_KNEE, R_KNEE, SPINE2, L_ANKLE, R_ANKLE, SPINE3, L_FOOT, R_FOOT,
 NECK, L_COLLAR, R_COLLAR, HEAD, L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW, L_WRIST, R_WRIST) = range(22)

X, Y, Z = np.eye(3)
TOES = np.array([0, -0.5, 1]) / np.sqrt(1.25)  # SMPL の立ち姿では足首からつま先が少し下を向く

# (VRM ボーン, 親ボーン, 根元の関節, 先の関節, T ポーズでの骨の向き)
# shortcut: T ポーズの向きは理想値で、モデルの実際の骨とずれると一定の傾きが残る。目立ったら初期フレームで較正する
LIMBS = [
    ("spine", "hips", SPINE1, SPINE2, Y),
    ("chest", "spine", SPINE2, SPINE3, Y),
    ("neck", "upperChest", NECK, HEAD, Y),
    ("leftShoulder", "upperChest", L_COLLAR, L_SHOULDER, X),
    ("leftUpperArm", "leftShoulder", L_SHOULDER, L_ELBOW, X),
    ("leftLowerArm", "leftUpperArm", L_ELBOW, L_WRIST, X),
    ("rightShoulder", "upperChest", R_COLLAR, R_SHOULDER, -X),
    ("rightUpperArm", "rightShoulder", R_SHOULDER, R_ELBOW, -X),
    ("rightLowerArm", "rightUpperArm", R_ELBOW, R_WRIST, -X),
    ("leftUpperLeg", "hips", L_HIP, L_KNEE, -Y),
    ("leftLowerLeg", "leftUpperLeg", L_KNEE, L_ANKLE, -Y),
    ("leftFoot", "leftLowerLeg", L_ANKLE, L_FOOT, TOES),
    ("rightUpperLeg", "hips", R_HIP, R_KNEE, -Y),
    ("rightLowerLeg", "rightUpperLeg", R_KNEE, R_ANKLE, -Y),
    ("rightFoot", "rightLowerLeg", R_ANKLE, R_FOOT, TOES),
]


def _normalize(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-8)


def _mul(a, b):
    ax, ay, az, aw = np.moveaxis(a, -1, 0)
    bx, by, bz, bw = np.moveaxis(b, -1, 0)
    return np.stack([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ], axis=-1)


def _inv(q):
    return q * np.array([-1, -1, -1, 1])


def _rotate(q, v):
    return _mul(_mul(q, np.concatenate([v, np.zeros(v.shape[:-1] + (1,))], axis=-1)), _inv(q))[..., :3]


def _swing(u, v, fallback_axis):
    """u を v に重ねる最短の回転。真逆のときは fallback_axis まわりに半回転する。"""
    u, v = _normalize(u), _normalize(v)
    w = 1 + np.sum(u * v, axis=-1, keepdims=True)
    q = np.concatenate([np.cross(u, v), w], axis=-1)
    flipped = w[..., 0] < 1e-6
    q[flipped] = np.concatenate([np.broadcast_to(fallback_axis, u.shape)[flipped], np.zeros((flipped.sum(), 1))], axis=-1)
    return _normalize(q)


def _frame(across, up):
    """左右方向 across を +X、上方向 up を +Y に向ける回転（腰や胸の向き。ひねりも含む）。"""
    across = _normalize(across)
    first = _swing(np.broadcast_to(X, across.shape), across, Z)
    up = up - np.sum(up * across, axis=-1, keepdims=True) * across  # across に直交する成分だけ使う
    # first で移した +Y と up はどちらも across に直交するので、この回転は across まわりになる
    return _mul(_swing(_rotate(first, np.broadcast_to(Y, up.shape)), up, across), first)


def to_motion_data(joints: np.ndarray) -> dict:
    """joints: (フレーム数, 22, 3) のメートル単位の位置。"""
    j = np.asarray(joints, dtype=np.float64)
    assert j.ndim == 3 and j.shape[1:] == (22, 3), f"unexpected joints shape {j.shape}"

    world = {
        "hips": _frame(j[:, L_HIP] - j[:, R_HIP], j[:, SPINE1] - j[:, PELVIS]),
        # 上半身のひねりは upperChest にまとめる。spine / chest は曲がるだけ
        "upperChest": _frame(j[:, L_COLLAR] - j[:, R_COLLAR], j[:, NECK] - j[:, SPINE3]),
    }
    local = {"hips": world["hips"]}
    n = len(j)
    for bone, parent, start, end, rest in LIMBS:
        # 親の回転で運んだ T ポーズの向きを、今の骨の向きに重ねる（ひねりは親から引き継ぐ）
        carried = _rotate(world[parent], np.broadcast_to(rest, (n, 3)))
        fallback = _rotate(world[parent], np.broadcast_to(Z, (n, 3)))
        world[bone] = _mul(_swing(carried, j[:, end] - j[:, start], fallback), world[parent])
        local[bone] = _mul(_inv(world[parent]), world[bone])
    local["upperChest"] = _mul(_inv(world["chest"]), world["upperChest"])

    # 体格の違いを吸収するため、腰の高さを 1 とした比で持つ（fbx2motion.mjs と同じ）。足が床 y=0 にある前提
    legs = np.linalg.norm(j[:, L_HIP] - j[:, L_KNEE], axis=-1) + np.linalg.norm(j[:, L_KNEE] - j[:, L_ANKLE], axis=-1)
    pelvis_above_hips = j[:, PELVIS, 1] - (j[:, L_HIP, 1] + j[:, R_HIP, 1]) / 2
    hips_height = float(np.median(legs + pelvis_above_hips)) + float(np.min(j[:, L_ANKLE, 1]))
    position = j[:, PELVIS] - j[0, PELVIS] * np.array([1, 0, 1])  # 最初は今の立ち位置から始める

    times = [round(i / FPS, 4) for i in range(len(j))]
    round4 = lambda a: np.round(a, 4).reshape(-1).tolist()
    tracks = {bone: {"rotation": {"times": times, "values": round4(q)}} for bone, q in local.items()}
    tracks["hips"]["position"] = {"times": times, "values": round4(position / hips_height)}
    return {"duration": times[-1], "tracks": tracks}
