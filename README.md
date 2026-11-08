# mirage-v2 — 施設の困りごと案内エージェント

カメラで人の動き・表情を読み取り、音声で会話を続ける AI アシスタント。
「置いておけば勝手に人を助ける案内エージェント」を目標に、**動くデモではなく運用・信頼性・テストまで設計したシステム**として作っている。

> 実装対象はこのリポ（mirage-v2）。旧 `mirage` リポは展示運用用・参考（[docs/decisions.md](docs/decisions.md) D-001）。

**今回のスコープ（2026-10-31）**: 1施設・1端末・複数人検知・会話は1人ずつ・日本語/英語。`接近 → 第一声 → 用件 → 映像文脈 → 回答 → 見送り → ログ` の1本＋必要なときだけWebで調べる＋管理画面（認証・状態・セッション・設定）を、品質保証まで通す（D-013〜D-017）。AIの長期記憶とGoバックエンドは持たない（D-012）。

## 現在の状態（2026-10-29）

| 領域 | 状態 |
| --- | --- |
| カメラ → 顔検出 → 距離推定 → 接近判定 | 動作中（150ms ループ） |
| 音声対話（Gemini Live）＋ 割り込み | 動作中 |
| フォールバック（Gemini → Ollama＋Web Speech） | 動作中（3 リトライ→切替→バナー→手動復帰） |
| トラッキング ＋ イベントログ（JSONL） | 動作中 |
| 俯瞰マップ（BEV 風 2D） | 動作中 |
| 映像理解（表情/服装 → 会話文脈へ注入） | 動作中 |
| リアルタイム情報 | 天気は Open-Meteo、イベント・ニュースは Tavily で検索、必要時のみ本文取得（crawl4ai）。施設の営業時間は `src/data/facility.ts` から即答。ブラウザは `/studio` proxy 経由（P21/P22 / D-017 / D-019） |
| キャラクター表示 | 2Dの三毛猫（SVGの多層リグ：まばたき・視線・口パク・首かせぎ・耳・手ふり・あくび・毛繕い）。画像に差し替える場合は `public/avatar/avatar.json` に `file` を書く。感情タグは任意（P8） |
| 複数人同時対応 | 未実装（検知は複数・会話は1人ずつ。P19 / D-015） |
| 多言語（JA/EN） | 未実装（自動判定。P20 / D-016） |
| 管理画面（Studio） | 土台のみ（Dashboard/Sessions/Settings はダミーデータ。P17/P18） |
| 認証 | 未実装（管理者1ロール。P17 / D-014） |
| バックエンド（Go） | なし（不採用。D-012） |
| DB | 予定: Studio の SQLite（運用データのみ。P17 / D-014） |
| 記憶 | AIの長期記憶なし。会話ログは運用記録として保存し、次回の文脈には注入しない（D-012 / D-014） |
| テスト | ブラウザ無しチェックスクリプト 2 本（`scripts/test-*.mjs`）。`pnpm test` 化・CI は未着手（P14・P15、**ポートフォリオの核**） |

## AI DJ / 3D stage（並行スパイク）

レセプション本線は `/` のまま。別枠として `/dance.html` に **AI DJ / 3Dパフォーマー** のスパイクを置いている。設計は [docs/ai-dj-architecture.md](docs/ai-dj-architecture.md)。

- 3Dロボットのダンス＋歩行＋ジェスチャー（Three.js）
- 2曲のWeb Audioシンセ、BPM同期、停止フェード、発話ダッキング
- Gemini LiveのDJ人格MC（出力専用。マイクは開かない）
- LLMのツールから `dance` / `stop_music` / `play_track` / `walk` / `talk` / `gesture` を実行
- 拍同期のプロシージャル身体（bounce / sway / head nod）＋クリップ

```bash
pnpm dev
# http://localhost:5173/dance.html
```

MCを使うには Studio（:3000）と `GEMINI_API_KEY` が必要。Studioが無くてもステージ操作は動く（MC OFFLINE表示）。

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
2D キャラクター表示（三毛猫のSVG。まばたき・視線・口パク・耳・手ふり・あくび・毛繕い。`public/avatar/` で画像に差し替え可）／BEV 俯瞰マップ
   ↓ 状態・イベント（WebSocket）／セッション・設定（REST）
Studio（Next.js）: Dashboard / Sessions / Settings ＋ SQLite（運用データ）
```

Mirage は Studio が落ちても案内を続ける（D-014）。AIの長期記憶は持たず、会話ログは運用記録としてのみ保存する（D-012 / D-014）。

## 起動方法

```bash
pnpm install
pnpm dev        # 全部まとめて起動 → http://localhost:5173
pnpm health     # サービス状態の確認
```

`pnpm dev` が起動するもの（すでに動いているものは再利用する）:

| サービス | ポート | 手動で起動する場合 |
| --- | --- | --- |
| vite（Mirage 本体） | 5173 | `pnpm dev:front` |
| Studio（管理画面・検索API） | 3000 | `cd studio && pnpm dev` |
| 本文取得（crawl4ai） | 11235 | `uv run --python 3.12 --with crawl4ai --with fastapi --with uvicorn scripts/crawl-server.py` |
| 検索 API（ddgs・任意） | 4479 | `uvx --from 'ddgs[api]' ddgs api`（`TAVILY_API_KEY` が無いときだけ使う） |

初回のみ:

```bash
cd studio && pnpm install --ignore-workspace      # Studio の依存
uv tool install --python 3.12 crawl4ai && crawl4ai-setup   # crawl4ai + Chromium
```

環境変数は **`studio/.env`** に置く（`cp studio/.env.example studio/.env`）。ルートの `.env` に秘密は置かない（D-018）。

| 変数 | 用途 |
| --- | --- |
| `GEMINI_API_KEY` | Live 用の短命トークン発行・見た目コメント。ブラウザには渡らない |
| `TAVILY_API_KEY` | Web検索。無ければ ddgs（:4479）で動く（開発用フォールバック） |
| `FACILITY_LAT` / `FACILITY_LON` / `FACILITY_PLACE` | 天気（Open-Meteo）の座標と地名。既定は横浜 |

ブラウザは Live 接続時に Studio の `/api/live/token` から30分の短命トークンを受け取る（`v1beta/auth_tokens`、preview 機能）。失敗時は「Studio 未起動」と表示する。Studio 側は管理者の認証情報と Mirage 用デバイストークンを使う（P17 / D-014）。

### 依存サービス

| サービス | 役割 | ポート / 接続先 |
| --- | --- | --- |
| Vite dev | フロント＋Ollama proxy | `5173` |
| Studio（Next.js） | 管理画面・管理API・認証・運用DB | `3000` |
| SQLite | Studio の運用データ（セッション/イベント/設定） | `studio/` 配下のファイル |
| カメラ／マイク | 顔検出・音声 | ブラウザ `getUserMedia`（許可必須） |
| Gemini Live | 本線 S2S 会話（STT+LLM+TTS） | ブラウザ直叩き（Studio が発行する短命トークン） |
| Tavily | Web検索（本文チャンク込み、P21 / D-019） | 外部 API（Studio の API Route 経由） |
| Open-Meteo | 天気の構造化データ（P21 / D-019） | 外部 API（Studio で10分キャッシュ） |
| Ollama | フォールバック LLM（任意） | `11434`（`/ollama` へ proxy） |
| Web Speech API | フォールバック STT／TTS（任意） | ブラウザ内蔵（ポート不要） |
| ddgs API | Web検索のフォールバック（`TAVILY_API_KEY` が無いとき） | `127.0.0.1:4479`（Studio の API Route 経由） |
| crawl4ai | 本文 Markdown 取得（P21 / D-017） | `127.0.0.1:11235`（`scripts/crawl-server.py`。uv で実行、Docker 不要） |

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
4. 2D キャラクター（三毛猫）が常時表示され、まばたき・視線・口パクが動く
5. 会話が自動開始し、音声で返答する
6. 途中で割り込むと会話が止まり、次の発話から続きる
7. 4 秒以上離れると会話が止まり、履歴がリセットされる
8. 停止ボタンで発話・会話が止まる
9. 複数人が映っても、会話は1人ずつ順番に成立する
10. 日本語・英語の両方で、同じ言語の回答が返る
11. 管理画面にログインでき、未ログインでは拒否される
12. Dashboard に状態・検知中/アクティブ/待ち・言語が出る
13. Studio を止めても Mirage の会話が続く
14. `pnpm build`（`tsc --noEmit && vite build`）が通る

検索の確認: 「今日の東京の天気は？」と話しかけると `web_search` が走る。検索 API（:4479）と crawl4ai（:11235）が落ちていると「今は調べられない」と返る。

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
├── studio/                     # 管理画面（Next.js App Router）
│   ├── app/                    # Dashboard / Sessions / Settings
│   └── studio.md               # 管理画面の開発方針・依頼の粒度
└── scripts/                    # dev.mjs / health-check.mjs / test-*.mjs / crawl-server.py
```

## ドキュメントの読み方

| 目的 | 読むファイル |
| --- | --- |
| 今何を作るか | [docs/requirements.md](docs/requirements.md) |
| なぜそう決めたか | [docs/decisions.md](docs/decisions.md) |
| 何を次にやるか | [docs/roadmap.md](docs/roadmap.md) |
| 管理画面の開発方針 | [studio/studio.md](studio/studio.md) |
| コードの構造・動作 | コードと [docs/requirements.md](docs/requirements.md) §2（実装箇所の表） |
| 過去の経緯 | [records/history.md](records/history.md) |
| ポートフォリオ用 | [records/portfolio.md](records/portfolio.md) |
| 作業の続きから | [docs/NEXT.md](docs/NEXT.md) |

## 開発方針

- 既存資産を活用し、必要な部分から改善する（全面書き換えをしない）。
- 3D の作り込みに工数を割かず、AI・信頼性・システム設計に注力する。
- 今回の完成形は1本の案内フロー＋管理画面。複数人・多言語は、この1本の品質を落とさない範囲で足す（D-013）。
- 管理・認証・運用データは `studio/`（Next.js）に集約する。Goは使わない（D-012 / D-014）。
- 性能と信頼性は感覚ではなく、テストと計測結果で評価する。
- 設計判断と理由は `docs/decisions.md` に残す。
