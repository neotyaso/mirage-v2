# Generated motion sample

`partlock-walk-joints.json` は PartLock-CMU（Apache 2.0）で生成した 2 秒の walk。
30fps / 22関節（SMPL順）で、MIRAGE の `GENERATE` ボタンのオフラインフォールバックに使う。

- モデル: https://huggingface.co/Yakimask/PartLock-CMU
- 再生成: `uvx --with pydantic modal run motion/partlock_modal.py --text "walk" --seconds 2 --format joints`
