# mirage-v2 — 駅・施設の困りごと案内エージェント

カメラで人の動き・表情を読み取り、音声で会話を続ける AI アシスタント。
「置いておけば勝手に人を助ける案内エージェント」を目標に、**動くデモではなく運用・信頼性・テストまで設計したシステム**として作っている。

> 実装対象はこのリポ（mirage-v2）。旧 `mirage` リポは展示運用用・参考（[docs/decisions.md](docs/decisions.md) D-001）。

## 現在の状態（2026-10-21）

| 領域 | 状態 |
| --- | --- |
| カメラ → 顔検出 → 距離推定 → 接近判定 | 動作中（150ms ループ） |
| 音声対話（Gemini Live）＋ 割り込み | 動作中 |
| フォールバック（Gemini → Ollama＋Web Speech） | 動作中（3 リトライ→切替→バナー→手動復帰） |
| トラッキング ＋ イベントログ（JSONL） | 動作中 |
| 俯瞰マップ（BEV 風 2D） | 動作中 |
| 映像理解（表情/服装 → 会話文脈へ注入） | 動作中 |
| キャラクター表示 | 2D（SVG＋CSS変数：まばたき・口パク・注視・視差）。実素材と感情タグは未仕込み（P10/P8） |
| バックエンド（Go）／DB（PostgreSQL） | 未着手（P11〜P13） |
| テスト | ブラウザ無しチェックスクリプト 2 本（`scripts/test-*.mjs`）。`pnpm test` 化・CI は未着手（P14・P15、**ポートフォリオの核**） |

## システム構成

```
カメラ（顔検出・接近検知）
   ↓
MediaPipe（顔トラッキング）／距離の自己推定（顔サイズ/眼間距離→m、実測補正 0.47）
   ↓
Gemini Live（音声対話・割り込み）   ← 障害時は Groq → ローカルへフォールバック
   ↓
TTS（音声合成）→ スピーカー
   ↓
2D キャラクター表示（SVG＋CSS変数：まばたき・口パク・注視・視差）／BEV 俯瞰マップ
```

## 起動方法

```bash
pnpm install
pnpm dev        # 起動チェック（vite + 補助サービスの状態確認）→ http://localhost:5173
pnpm dev:front  # vite のみ
pnpm health     # サービスのヘルスチェック
```

必要な環境変数は `.env.example` を参照（`GROQ_API_KEY` / `VITE_GEMINI_API_KEY`）。ブラウザ側は Vite proxy 経由でGroq にアクセスし、API キーはブラウザに露出しない。

### 依存サービス

| サービス | 役割 | ポート / 接続先 |
| --- | --- | --- |
| Vite dev | フロント＋Ollama proxy | `5173` |
| カメラ／マイク | 顔検出・音声 | ブラウザ `getUserMedia`（許可必須） |
| Gemini Live | 本線 S2S 会話（STT+LLM+TTS） | ブラウザ直叩き（`VITE_GEMINI_API_KEY`） |
| Ollama | フォールバック LLM（任意） | `11434`（`/ollama` へ proxy） |
| Web Speech API | フォールバック STT／TTS（任意） | ブラウザ内蔵（ポート不要） |

## テスト

```bash
node scripts/test-avatar2d.mjs   # 2D アバターの状態ロジック（ブラウザ不要）
node scripts/test-tracking.mjs   # トラッキング・イベントログ
```

## 展示前チェックリスト

挙動を変えるリファクタのあと、手動で 1 巡する。

1. コンソールエラーなしで起動する
2. カメラ許可 → HUD に `cam: ok`
3. 顔を認識すると距離（far/mid/near）が変わる
4. 2D キャラクターが常時表示され、まばたき・口パク・注視が動く
5. 会話が自動開始し、音声で返答する
6. 途中で割り込むと会話が止まり、次の発話から続きる
7. 4 秒以上離れると会話が止まり、履歴がリセットされる
8. 停止ボタンで発話・会話が止まる
9. `pnpm build`（`tsc --noEmit && vite build`）が通る

デバッグ操作: `d` でデバッグ UI 切替。表示中は一時停止・手動会話・距離調整ができる。`/playground.html` でアバター調整だけを単独確認できる。

## ディレクトリ構成

```
mirage-v2/
├── src/
│   ├── App.tsx                 # 会話・カメラ・UI の中枢
│   ├── components/             # Avatar2D / BevMap / DebugPanel / 他
│   ├── hooks/                  # useGeminiLive / useVisitorLoop / useFaceDetection / conversation/*
│   ├── tracking/               # 通行人トラッキング＋イベントログ
│   └── vision/                 # 表情・属性の抽出
├── docs/                       # 仕様（正本）
│   ├── requirements.md         # 要件定義 ＋ 完了条件（DoD）
│   ├── decisions.md            # 設計判断（有効なもの・理由つき）
│   ├── roadmap.md              # ロードマップ（状態・依存・着手順）
│   └── NEXT.md                 # 再開メモ（読む順・次にやること）
├── records/                    # 記録（指示ではない）
│   ├── history.md              # 日付つきの作業ログ・経緯・相談ログ
│   └── portfolio.md            # 開発記録（ポートフォリオ用）
├── studio/                     # 別 Next.js アプリ（create-next-app ベース）
│   └── studio.md               # 開発方針・依頼の粒度
└── scripts/                    # dev.mjs / health-check.mjs / test-*.mjs
```

## ドキュメントの読み方

| 目的 | 読むファイル |
| --- | --- |
| 今何を作るか | [docs/requirements.md](docs/requirements.md) |
| なぜそう決めたか | [docs/decisions.md](docs/decisions.md) |
| 何を次にやるか | [docs/roadmap.md](docs/roadmap.md) |
| コードの構造・動作 | コードと [docs/requirements.md](docs/requirements.md) §2（実装箇所の表） |
| 過去の経緯 | [records/history.md](records/history.md) |
| ポートフォリオ用 | [records/portfolio.md](records/portfolio.md) |
| 作業の続きから | [docs/NEXT.md](docs/NEXT.md) |

## 開発方針

- 既存資産を活用し、必要な部分から改善する（全面書き換えをしない）。
- 3D の作り込みに工数を割かず、AI・バックエンド・システム設計に注力する。
- 性能と信頼性は感覚ではなく、テストと計測結果で評価する。
- 設計判断と理由は `docs/decisions.md` に残す。
