"""PartLock-CMU を Modal の GPU で動かす最小サーバー。

    uvx modal run motion/partlock_modal.py --text "walk" --seconds 2
    uvx modal deploy motion/partlock_modal.py

モデル: https://huggingface.co/Yakimask/PartLock-CMU (Apache 2.0)
出力: 30fps / 22関節 / SMPL順。`--format vrm` で retarget.py の {duration, tracks} も返す。
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import modal
from pydantic import BaseModel, Field

APP_NAME = "mirage-partlock"
PARTLOCK_DIR = "/root/partlock"
WEIGHTS_DIR = f"{PARTLOCK_DIR}/weights"
REPO_ID = "Yakimask/PartLock-CMU"
WEIGHT_FILES = ("generator.safetensors", "tokenizer.safetensors", "Mean.npy", "Std.npy")

HERE = Path(__file__).resolve().parent
LOCAL_PARTLOCK = HERE / "partlock"


def _download_clip() -> None:
    """CLIP の重みをイメージに焼き込み、コールドスタートを短くする。"""
    from transformers import CLIPTextModelWithProjection, CLIPTokenizer

    name = "openai/clip-vit-base-patch32"
    CLIPTokenizer.from_pretrained(name)
    CLIPTextModelWithProjection.from_pretrained(name, use_safetensors=True)


image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.5.1",
        "numpy>=1.26",
        "transformers>=4.40,<5",
        "safetensors>=0.4",
        "huggingface_hub>=0.24",
        "fastapi>=0.115",
        "pydantic>=2",
    )
    .run_function(_download_clip)
    .add_local_dir(str(LOCAL_PARTLOCK), remote_path=PARTLOCK_DIR, ignore=["weights"])
)

app = modal.App(APP_NAME)
volume = modal.Volume.from_name("mirage-partlock-weights", create_if_missing=True)


def _ensure_weights() -> None:
    """重みは Modal Volume に一度だけ置く。無いときだけ Hugging Face から取る。"""
    os.makedirs(WEIGHTS_DIR, exist_ok=True)
    missing = [name for name in WEIGHT_FILES if not os.path.exists(os.path.join(WEIGHTS_DIR, name))]
    if not missing:
        return
    from huggingface_hub import hf_hub_download

    for name in missing:
        hf_hub_download(repo_id=REPO_ID, filename=f"weights/{name}", local_dir=PARTLOCK_DIR)
    volume.commit()


_L = None


def _load():
    """PartLock の live_server を遅延ロードする。モデルはコンテナごとに1回だけ。"""
    global _L
    if _L is not None:
        return _L
    _ensure_weights()
    sys.path.insert(0, f"{PARTLOCK_DIR}/live")
    sys.path.insert(0, PARTLOCK_DIR)
    import live_server as L

    try:
        L.ENG = L.Engine()
    except Exception as error:  # CUDA graph が使えない環境では通常の forward に落ちる
        print(f"CUDA graph setup failed, falling back: {error!r}", flush=True)
        L.ENG = None
    _L = L
    return L


def _generate(text: str, seconds: float, strength: float, seed: int, fmt: str) -> dict:
    import numpy as np
    import torch

    seconds = min(max(float(seconds), 0.5), 10.0)
    strength = min(max(float(strength), 0.0), 10.0)
    L = _load()
    torch.manual_seed(int(seed))
    w = L.reset_world()
    cond = L.embed(L.tok, L.clip, [text]).float()

    steps = max(1, int(round(seconds * 30 / 4)))
    positions, rotations, roots = [], [], []
    for _ in range(steps):
        for frame in L.one_step(w, cond, strength):
            p = np.array(frame["p"], np.float32).reshape(22, 3)
            p[:, 0] += frame["tr"][0]
            p[:, 2] += frame["tr"][1]
            positions.append(p)
            rotations.append(np.array(frame["r"], np.float32).reshape(22, 3, 3))
            roots.append(frame["tr"])

    joints = np.stack(positions)
    if fmt == "vrm":
        from retarget import to_motion_data

        return {"format": "vrm", **to_motion_data(joints)}

    return {
        "format": "joints",
        "fps": 30,
        "duration": round(len(positions) / 30, 4),
        "positions": joints.round(4).tolist(),
        "rotations": np.stack(rotations).round(4).tolist(),
        "root_xz": np.array(roots, np.float32).round(4).tolist(),
    }


@app.function(
    image=image,
    gpu="A10G",
    timeout=300,
    scaledown_window=60,
    volumes={WEIGHTS_DIR: volume},
)
def generate(text: str, seconds: float = 2.0, strength: float = 4.0, seed: int = 1, fmt: str = "joints") -> dict:
    return _generate(text, seconds, strength, seed, fmt)


class Request(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    seconds: float = 2.0
    strength: float = 4.0
    seed: int = 1
    format: str = "joints"


@app.function(image=image, scaledown_window=60)
@modal.asgi_app()
def api():
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    web_app = FastAPI()
    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @web_app.post("/generate")
    def generate_endpoint(req: Request) -> dict:
        fmt = req.format if req.format in ("joints", "vrm") else "joints"
        return generate.remote(req.text, req.seconds, req.strength, req.seed, fmt)

    return web_app


@app.local_entrypoint()
def main(
    text: str = "walk",
    seconds: float = 2.0,
    strength: float = 4.0,
    seed: int = 1,
    format: str = "joints",
) -> None:
    out = generate.remote(text, seconds, strength, seed, format)
    print(json.dumps({k: v for k, v in out.items() if k not in ("positions", "rotations", "root_xz", "tracks")}, ensure_ascii=False, indent=2))
    out_dir = HERE / "out"
    out_dir.mkdir(exist_ok=True)
    path = out_dir / f"partlock-{text.replace(' ', '_')[:40]}-{format}.json"
    path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"saved {path}")
