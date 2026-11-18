# PartLock-CMU on Modal

PartLock-CMU（Apache 2.0）を Modal の GPU で動かし、テキストから22関節のモーションを生成する。
MIRAGE 側は `studio/src/dance/generated.ts` で Mixamo のローカル回転に変換して再生する。

- モデル: https://huggingface.co/Yakimask/PartLock-CMU
- 出力: 30fps / 22関節（SMPL順）
- 生成できる動き: CMU MoCap にある短い英語キャプション（`walk`, `run/jog`, `jump`, `Wave`, `kick`, `salsa dance`, `boxing` など）

## デプロイ

```bash
uvx --with pydantic modal deploy motion/partlock_modal.py
```

表示された URL の末尾に `/generate` を付けて、`studio/.env.local` に置く（Next.js が読む）:

```env
NEXT_PUBLIC_MOTION_URL=https://<workspace>--mirage-partlock-api.<region>.modal.run/generate
```

未設定のときは `studio/public/motion/partlock-walk-joints.json` のサンプルを再生する。

## API

```bash
curl -X POST "$NEXT_PUBLIC_MOTION_URL" \
  -H 'Content-Type: application/json' \
  -d '{"text":"walk","seconds":2,"format":"joints"}'
```

- `format: "joints"`（既定）: `{format, fps, duration, positions: [T][22][3], rotations, root_xz}`
- `format: "vrm"`: `{format, duration, tracks}`（VRM 正規化ボーン。Mixamo には `joints` を使う）
- CORS は全オリジン許可（公開前にトークンかプロキシを追加する）

## コスト

- `min_containers` なし。GPU はリクエストが来たときだけ起動する。
- `scaledown_window=60`。最後のリクエストから60秒で停止する。
- 停止確認:

```bash
uvx modal app list
uvx modal container list
```

すぐ止めたいときは `uvx modal app stop -y <app-id>`（デプロイも消える）。

## ライセンス

- コードと重み: Apache 2.0（`motion/partlock/LICENSE`）
- 学習データ: CMU Motion Capture Database（商用製品への同梱は可、データ自体の再販は不可）
- 大きな `.safetensors` はリポジトリに置かず、Modal Volume `mirage-partlock-weights` に置く。

## 制限

- CMU にない動きはほぼ静止する。任意テキストの表現力が必要なら FloodDiffusion か Kimodo を検討する。
- 生成モーションは拍に同期していない。MIRAGE では1回再生し、次の小節でダンスへ戻す。
- エンドポイントは未認証。公開展示の前に必ず認証を入れる。
