# mirage-v2 — AI DJ / 3Dパフォーマー

3D キャラクターが音楽に合わせて踊る **AI DJ ステージ**。LLM が公演の流れを考える設計だが、現在はダンス主体で MC は休止中。
Text-to-Motion のデモではなく、**判断（LLM）・音楽（MusicTransport）・身体（モーションエンジン）を別の時計で動かす** ことを核にしている。

> 2026-11-08 にレセプション本線を退役し、AI DJ 本線へ切り替えた（[docs/decisions.md](docs/decisions.md) D-023）。
> 当時の受付要件は [docs/legacy/reception-requirements.md](docs/legacy/reception-requirements.md) にアーカイブしている。

## 何が動くか

- Mixamo の人間キャラ（Michelle）＋モーションキャプチャのダンス、歩行（Three.js）
- Pixabay の無料楽曲「Dance Electro 120 bpm - Full」（120 BPM、LiteSaturation）
- BPM 同期、停止フェード、発話ダッキング、拍位相
- Gemini Live の DJ 人格 MC（コードは残るが現在は未接続）
- LLM のツール定義（`dance` / `stop_music` / `play_track` / `walk` / `talk` / `gesture`）は残るが、MC 接続は休止中
- 4 style（hype / cool / cute / chill）を Mixamo のダンスクリップへマップし、BPM に `timeScale` を合わせる
- MIRAGE ヘッダー、モード／曲／BPM／小節の readout、SOUND ON / OFF、モバイル対応

**公演の1巡**: ダンス → 音楽停止 → 歩行 → 曲を頭から再開 → ダンス。

## 起動

```bash
pnpm install
pnpm dev
# http://localhost:5173
```

`/dance.html` も互換エイリアスとして同じステージを開く。

MC を使うには Studio（:3000）と `GEMINI_API_KEY` が必要。Studio が無くてもステージ操作は動く（MC OFFLINE 表示）。

```bash
cd studio && pnpm install --ignore-workspace
cp studio/.env.example studio/.env   # GEMINI_API_KEY を書く
pnpm dev
```

## アーキテクチャ

```
Director (Gemini Live)
   │  ShowAction / Cue（1〜2小節ごと）
   ├──────────────┬──────────────┐
   ▼              ▼              ▼
MusicTransport   Body          MC Voice
曲/停止/拍       Locomotion    発話/ダッキング
                 Dance
                 Gesture
                 Face
   └──────────────┴──────────────┘
                  ▼
             3D Character
```

### 3つの時計

| 時計 | 周期 | 担当 |
| --- | --- | --- |
| 思考 | 1〜2小節 | LLM。何を話すか、いつ止めるか、次にどの曲か |
| 身体 | 60fps | モーション。関節、重心、ブレンド、歩行 |
| 音楽 | 拍・小節 | MusicTransport。BPM、拍位相、セクション |

LLM に毎フレームの関節を出させない。身体は前の cue を続け、判断が遅れても公演を止めない。

### モーションの 90 / 10

- **90%**: atom（小節ごとの短い動きの部品）＋ procedural（拍同期の bounce / sway / hip / head）。style は `cute / cool / hype / chill`、moves は `bounce / sway / stepTouch / armWave / point / spin / pose / headNod`。
- **10%**: 生成モデルによる special。サビ・ドロップなど限定。2〜4秒先読みし、間に合わなければ atom に落とす。

詳しい設計は [docs/ai-dj-architecture.md](docs/ai-dj-architecture.md)。

## ディレクトリ構成

```
mirage-v2/
├── index.html                  # / の DJ ステージ
├── dance.html                  # 互換エイリアス
├── src/
│   ├── dance/                  # DanceStage / dance核 / show / audio / mc / UI
│   ├── hooks/
│   │   ├── useGeminiLive.ts    # Live 接続・カスタムプロンプト／ツール
│   │   ├── useFaceDetection.ts # 観客入力の再利用資産
│   │   └── useVision*.ts       # Studio のカメラ監視
│   ├── vision/                 # 表情・フレーム取得
│   └── tracking/               # 通行人トラッキング（再利用資産）
├── studio/                     # Next.js。Live 短命トークン・API 中継
├── docs/                       # 要件・決定・ロードマップ・設計
│   └── legacy/                 # レセプション時代のアーカイブ
├── records/                    # 作業ログ・ポートフォリオ
└── scripts/                    # dev / health / 自己テスト / crawl
```

## テスト

```bash
pnpm build       # tsc --noEmit && vite build
pnpm test        # トラッキング＋Mixamo アセット＋旧ダンス核の自己テスト
```

Mixamo アセットのテストは `scripts/test-mixamo.mjs`（GLB の存在・アニメーション・スキン）。旧ダンス核のテストは `scripts/test-dance.mjs`。公演状態機械・BPM 同期・キュー量子化のテストは `DJ-9` で追加する（[docs/roadmap.md](docs/roadmap.md)）。

## 展示前チェックリスト

1. `pnpm build` が通る。
2. `/` で 3D ステージが起動する。
3. 「START SESSION」で音楽とダンスが始まる。
4. キャラクターが床に接地し、BPM に合わせてダンスがループする。
5. SOUND ON / OFF が効く。
6. デスクトップと縦長画面でキャラクターが画面内に収まる。
7. MC は休止中。MC 字幕は出ず、ステージはダンスのみで動く。
8. モバイル幅で UI が崩れない。
9. 長時間動かしてメモリ・音切れ・タイマーのリークがない。

## ドキュメント

| 目的 | 読むファイル |
| --- | --- |
| 今何を作るか | [docs/requirements.md](docs/requirements.md) |
| なぜそう決めたか | [docs/decisions.md](docs/decisions.md) |
| 何を次にやるか | [docs/roadmap.md](docs/roadmap.md) |
| AI DJ の設計 | [docs/ai-dj-architecture.md](docs/ai-dj-architecture.md) |
| 再開メモ | [docs/NEXT.md](docs/NEXT.md) |
| 過去の経緯 | [records/history.md](records/history.md) |
| レセプション時代 | [docs/legacy/](docs/legacy/) |

## 開発方針

- LLM はディレクター。身体の 60fps ループに入れない。
- 90% は即時・安定・安い atom＋procedural。10% だけ生成 special。
- 失敗は「止まる」ではなく「atom に落ちる」。
- API キーはブラウザに置かない。Studio の短命トークンを使う（D-018）。
- 設計判断と理由は [docs/decisions.md](docs/decisions.md) に残す。
- テストは機能実装と同時に入れる（D-006）。
