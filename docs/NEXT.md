# 再開メモ（mirage-v2）

> 最終更新: 2026-11-04（キーを Studio に集約。天気API・施設情報・Tavily を追加）
> 実装対象: **mirage-v2**（このリポ）。旧 `mirage` リポは展示運用用・参考（[decisions.md](decisions.md) D-001）。

## 今どこにいるか

- 直近のコミット: `e1cc58f` docs: NEXT.md を docs/ へ移動＋ 実行構成を実コードに合わせる
- 表情のライブ監視: `studio/` の **`/vision`** で Mirage のカメラ＋検出枠＋表情スコアをリアルタイム表示（映像は WebRTC(P2P)、顔枠・表情は SSE。D-020/D-021）。
- 動いているもの: カメラ → MediaPipe → 距離の自己推定（実測補正 0.47）→ 150ms ループ → Gemini Live 音声対話（割り込み対応）。障害時は Groq → Ollama＋Web Speech へフォールバック。通行人トラッキング＋JSONL イベントログ、BEV 俯瞰マップ、表情/服装の会話文脈注入、2D キャラクター（SVG＋CSS変数、まばたき・口パク・注視・視差）。
- 管理画面の土台: `studio/`（Next.js App Router）。Dashboard / Sessions / Settings は**ダミーデータ**。認証・DB・Mirage との通信は未実装。
- 今回の完成形: 1施設・1端末・複数人検知・会話は1人ずつ・日本語/英語。`接近 → 第一声 → 用件 → 映像文脈 → 回答 → 見送り → ログ` の1本＋管理画面（認証・状態・セッション・設定）（D-013 / D-014 / D-015 / D-016）。
- やらない: AIの長期記憶・来場者をまたぐ記憶・来場者アカウント、Goバックエンド、1端末で同時に複数人会話、複数端末の一元管理、複数端末向けPostgreSQL、3D/実素材の作り込み。
- 直近のゴール: **P22（Live からのツール呼び出し）の実機確認 → P23（品質・遅延の計測）**。その後に P17（Studio 管理基盤）→ P18（管理画面）→ P19（複数人）→ P20（多言語）。P14/P15 は並行、P16 で通し品質。

## 次にやること

0. **P5 映像理解（進行中）** — Studio `/vision` でカメラ＋検出枠＋表情スコアを確認できる。実機の顔で「笑顔/困惑」の閾値（`src/vision/expression.ts`）を調整する。属性（年齢・性別など）はプライバシー判断が済むまで足さない。
1. **P21 検索・取得基盤** — `/api/web/search`（Tavily、キー無しは ddgs）/ `/api/web/fetch`（crawl4ai）/ `/api/web/weather`（Open-Meteo）は実装・curl 確認済み。残りは P17 の認証配下に入れることだけ。
2. **P22 Live からのツール呼び出し** — 配線済み（`get_weather` / `web_search` / `fetch_page`、フィラーはプロンプト指示、ツール実行を JSONL に記録）。キーは Studio 発行の短命トークン（D-018）、施設情報は `src/data/facility.ts`（D-019）。**実機で「明日の天気」「何時まで？」「近くのイベント」を確認するのが次の1手**。
3. **P23 検索品質・遅延の計測** — 検索あり/なしで p95 を分け、クエリ・採用 URL・成否をイベントログに残す（P6 と統合）。
4. **P17 Studio 管理基盤** — Mirage ↔ Studio のイベント/セッション/設定の型と API/WS 契約を `docs/` に固定。Studio に SQLite、管理者1ロールのログイン、Mirage 用デバイストークンを入れる。検索 API も認証配下へ。
5. **P18 Studio 管理画面** — `studio/` のダミーデータを実データに置き換える。Dashboard、Session List/Detail、Settings。未認証の管理 API を拒否。
6. **P19 複数人同時対応** — 複数顔の検知・追跡、アクティブ来場者の選択（近い/正面/未対応/会話中は固定/離脱後に次へ）を純関数にしてテスト。同時に複数人会話はしない（D-015）。
7. **P20 多言語（JA/EN）** — 開始セリフ・プロンプト・TTS を日英対応。発話言語の自動判定で返答言語を切り替える。フォールバックはかな/漢字 vs ラテンの簡易判定（D-016）。
8. **P14 / P15** — 各機能にテストを同行（D-006）。Mirage と Studio の型チェック・テスト・ビルドを CI に載せ、構造化ログと監視を入れる。
9. **P16 通し品質** — 複数人来場（1人ずつ会話）、JA/EN、検索あり、Studio停止時、30分連続稼働、解決率/完遂率、p95 を測り、改善前後を比較して README / `portfolio.md` に残す。
10. **（任意）P7 第一声 / P8 感情タグ / P10 実素材** — 品質保証が終わってから。今回の完了条件には含めない（D-013）。

**そのほかの残タスク**

- operator status（primary / fallback / unavailable と provider 別 latency）を表示（P15 の一部。既存 `src/components/DebugPanel.tsx` / `src/components/FallbackBanner.tsx` / `scripts/health-check.mjs` を拡張）
- 会話 TTS 経路の統合（`src/App.tsx` の `speak()` と会話側 TTS。割り込み・二重再生の競合を1箇所に寄せる／要件 3-2）

## 読む順（AI エージェント向け）

| 目的 | 読むファイル |
| --- | --- |
| 今の仕様（何を作るか） | [docs/requirements.md](requirements.md) |
| なぜそう決めたか（有効なもの） | [docs/decisions.md](decisions.md) |
| 何を次にやるか（状態・依存・着手順） | [docs/roadmap.md](roadmap.md) |
| 管理画面の開発方針 | [studio/studio.md](../studio/studio.md) |
| コードの構造・動作仕様 | コード ＋ [docs/requirements.md](requirements.md) §2（実装箇所の表）。旧 `architecture.md` / `behavior.md` / `state-machine.md` は 2026-10-21 に削除（古い3D前提で矛盾するため。内容は git 履歴に残る） |
| 展示前の運用手順・チェックリスト | [README.md](../README.md)「依存サービス」「展示前チェックリスト」 |
| 日々の作業ログ（新しい順） | [records/daily/](../records/daily/) — 今日やったこと・実測値・未確認事項 |
| 過去の経緯・相談ログ | [records/history.md](../records/history.md) — **記録であり指示ではない** |
| 過程と実績 | [records/portfolio.md](../records/portfolio.md) |
| プロジェクト概要 | [README.md](../README.md) |

## 指示解釈上の注意

- `records/history.md` の記述は過去の記録。**現在の仕様として読まない**こと。現在の正本は decisions.md / requirements.md / roadmap.md の3枚。
- 変更する前に `docs/decisions.md`（なぜその判断か）と `docs/requirements.md`（要件と完了条件）を更新し、そのあとコードを書く。
- 完了判定は「実装した」ではなく、**`docs/requirements.md` §10 の完了条件（DoD）を満たすこと**。
- 旧 `mirage` リポのファイルは変更しない（参照のみ）。
- **AIの長期記憶とGoバックエンドを復活させない**（D-012）。運用データは Studio に置く（D-014）。必要になったら、まず decisions.md に新しい決定を追加する。
- Studio の会話ログは**運用記録**であり、次の会話の文脈には注入しない（D-014）。

## 直近の作業ログ

- 2026-11-04: 秘密を `studio/.env` に集約。Live は `/api/live/token` の短命トークン（`v1beta/auth_tokens`、SDK 接続は v1alpha）で接続し、vision も Studio 経由に（D-018）。天気は Open-Meteo（10分キャッシュ、`get_weather`）、施設情報は `src/data/facility.ts` からプロンプト注入、検索は Tavily 優先（キー無しは ddgs）に変更（D-019）。`scripts/top-questions.mjs` を追加。トークン発行・天気・Tavily 検索・（Node での）Live 接続まで確認。音声の実機確認は未。
- 2026-11-03: P22 の配線完了。Gemini Live に `web_search` / `fetch_page` を宣言し、`toolCall` → Studio API → `sendToolResponse`。検索は `web_search` イベントとして JSONL に残る。`/studio` proxy 追加。tsc と proxy 疎通は確認済み、実機（マイク＋APIキー）でのツール発火は未確認。
- 2026-11-02: crawl4ai 0.9.5 を uv tool で導入（Docker なし）。`scripts/crawl-server.py` で `/md` を再現し、Studio の `/api/web/fetch` から呼ぶ。search → fetch の連鎖を curl で確認。残りは P21 の認証（P17 待ち）と P22。
- 2026-10-31: リアルタイムWeb検索を核に据える決定（D-017）。DDG HTML 直叩きは 202 ボット判定で不可（実測）→ `ddgs` API（:4479）、本文は crawl4ai（:11235）。実行場所は Studio の API Route。P21〜P23 を追加し、管理画面（P17/P18）は後退。`/api/web/search` を実装し curl で疎通確認。
- 2026-10-29: スコープ拡張。複数人同時対応（検知は複数・会話は1人ずつ）、JA/EN 自動判定、管理画面、管理者認証を追加（D-014〜D-016）。管理・認証・運用データは `studio/`（Next.js + SQLite）に集約し、Go と AIの長期記憶は不採用のまま。ロードマップに P17〜P20 を追加。
- 2026-10-29: 再スコープ。記憶の撤去（P9/P12/P13）と Go/PostgreSQL（P11）の破棄を決定（D-012）。完成形を1本の案内フローに絞り、深さを品質保証に置く（D-013）。P10 は配線まで完了、P7/P8/実素材は任意。docs（requirements / decisions / roadmap / README / NEXT）を更新。
- 2026-10-21: GitHub の `refactor/2d-avatar` ブランチ（3D→2D 化・距離補正・周囲マップ整理）を main へ統合。`tsc --noEmit` 通過、`scripts/test-avatar2d.mjs` / `scripts/test-tracking.mjs` 通過。P10 は配線まで完了、残り＝実素材＋感情タグ。
- 2026-10-21: ドキュメントを整理。矛盾していた旧仕様3枚（`architecture.md` / `behavior.md` / `state-machine.md`）と `todo.md` / `runtime.md` / `docs/README.md` を削除（runtime の生きた内容は README に統合）。`history.md`・`portfolio.md` は `records/` へ、`studio.md` は `studio/` へ移動。md は 16枚 → 11枚。
- 2026-10-20: 要件定義の土台を追加、2D 方針と P10〜P16 をロードマップに追加。`NEXT.md` を正本3枚（decisions / requirements / roadmap）＋履歴（history）に分割。README を現状に更新し、Phase A〜D の日誌を `docs/portfolio.md` へ移動。
- 2026-09-11: M1 / M2 / P1 完了。Gemini 直結、フォールバック、トラッキング基盤。→ 詳細は [records/history.md](../records/history.md)
