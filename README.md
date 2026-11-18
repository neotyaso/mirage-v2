# mirage-v2 — AI DJ / 3Dパフォーマー

3D キャラクターが音楽に合わせて踊る **AI DJ ステージ**。LLM が公演の流れを考える設計だが、現在はダンス主体で MC は休止中。
Text-to-Motion のデモではなく、**判断（LLM）・音楽（MusicTransport）・身体（モーションエンジン）を別の時計で動かす** ことを核にしている。

`/` は **Gemini Live と話せる会話ページ**、`/dance` は **ダンスステージ**（`/dance.html` は rewrite）。いまは別ページに分けている。

> 2026-11-08 にレセプション本線を退役し、AI DJ 本線へ切り替えた（[docs/decisions.md](docs/decisions.md) D-023）。
> 当時の受付要件は [docs/legacy/reception-requirements.md](docs/legacy/reception-requirements.md) にアーカイブしている。

## 何が動くか

- Mixamo の人間キャラ（Michelle）＋モーションキャプチャのダンス、歩行（Three.js）
- Pixabay の無料楽曲「Dance Electro 120 bpm - Full」（120 BPM、LiteSaturation）
- BPM 同期、停止フェード、発話ダッキング、拍位相
- 手動ビートグリッド（120 BPM / 先頭ダウンビート 0.987s / 60小節）と、小節頭のセクション切替（intro / drop / break / build / outro）
- `playTrack` / `stopMusic` / `dance` の nextBar 量子化
- Gemini Live の会話ページ（`/`）。マイク入力・S2S・字幕なし
- ダンスステージの DJ 人格 MC は未接続。LLM のツール定義（`dance` / `stop_music` / `play_track` / `walk` / `talk` / `gesture`）は残している
- 4 style（hype / cool / cute / chill）を Mixamo のダンスクリップへマップし、BPM に `timeScale` を合わせる
- MIRAGE ヘッダー、モード／曲／BPM／セクション/style の readout、STOP MUSIC / PLAY MUSIC、SOUND ON / OFF、モバイル対応
- 開始前の黒背景・白文字オーバーレイ（PLEASE TURN UP THE VOLUME.）
- テキストから生成したモーション（Modal の PartLock-CMU）を **GENERATE** ボタンで再生。22関節を Mixamo のボーンへリターゲットし、次の小節でダンスへ戻す

**公演の1巡**: ダンス → 音楽停止 → 歩行 → 曲を頭から再開 → ダンス。

## 起動

```bash
pnpm install                 # ルート: テスト用
cd studio && pnpm install    # アプリ本体
cp .env.example .env         # GEMINI_API_KEY を書く
cd ..
pnpm dev
# 会話:    http://localhost:3000/
# ダンス:  http://localhost:3000/dance
# Studio:  http://localhost:3000/studio
```

`/dance.html` は `/dance` に rewrite される。

会話ページを使うには `GEMINI_API_KEY` が必要。ダンスステージはキーなしでも動く。`studio/.env.local` に `NEXT_PUBLIC_MOTION_URL` を置くと、GENERATE が Modal の PartLock を呼ぶ。未設定なら `studio/public/motion/partlock-walk-joints.json` のサンプルを再生する。

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
├── studio/                     # Next.js アプリ本体
│   ├── app/(stage)/            # / = 会話、/dance = ダンス
│   ├── app/studio/             # /studio 管理ダッシュボード
│   ├── app/api/                # Liveトークン・検索・天気・Vision
│   ├── src/                    # talk / dance / hooks / vision / tracking / web / data
│   └── public/                 # models / audio / motion / mediapipe
├── motion/                     # Modal PartLock-CMU サーバー
├── docs/                       # 要件・決定・ロードマップ・設計
│   └── legacy/                 # レセプション時代のアーカイブ
├── records/                    # 作業ログ・ポートフォリオ
└── scripts/                    # dev / health / 自己テスト / crawl
```

## テスト

```bash
pnpm build       # Next.js build（studio/）
pnpm test        # トラッキング＋Mixamo アセット＋音源＋ビートグリッド／セクション＋旧ダンス核の自己テスト
```

Mixamo アセットのテストは `scripts/test-mixamo.mjs`（GLB の存在・アニメーション・スキン）。ビートグリッドとセクション割りは `scripts/test-sections.mjs`、旧ダンス核は `scripts/test-dance.mjs`。公演状態機械・キュー量子化の残りのテストは `DJ-9` で追加する（[docs/roadmap.md](docs/roadmap.md)）。

## 展示前チェックリスト

1. `pnpm build` が通る。
2. `/` で会話ページが起動し、START で Gemini Live に接続できる。
3. `/dance` で 3D ステージが起動する。
4. 「START SESSION」で音楽とダンスが始まる。
5. キャラクターが床に接地し、BPM に合わせてダンスがループする。
6. SOUND ON / OFF が効く。
7. デスクトップと縦長画面でキャラクターが画面内に収まる。
8. ダンスステージの MC は休止中。会話ページは字幕なしで動く。
9. モバイル幅で UI が崩れない。
10. 長時間動かしてメモリ・音切れ・タイマーのリークがない。

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
