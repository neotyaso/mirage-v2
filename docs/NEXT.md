# 再開メモ（mirage-v2）

> 最終更新: 2026-10-21（`docs/` へ移動。正本は docs/ 配下3枚＋このメモ）
> 実装対象: **mirage-v2**（このリポ）。旧 `mirage` リポは展示運用用・参考（[decisions.md](decisions.md) D-001）。

## 今どこにいるか

- 直近のコミット: `a764015` docs: 仕様を正本3枚に整理
- 動いているもの: カメラ → MediaPipe → 距離の自己推定（実測補正 0.47）→ 150ms ループ → Gemini Live 音声対話（割り込み対応）。障害時は Ollama＋Web Speech へフォールバック。通行人トラッキング＋JSONL イベントログ、BEV 俯瞰マップ、表情/服装の会話文脈注入。**2D キャラクター（SVG＋CSS変数、まばたき・口パク・注視・視差）**。
- 動いていないもの: 2D キャラクターの実素材と感情タグ（P8）、バックエンド（Go）、DB（PostgreSQL）、テストの `pnpm test` 化、CI/CD、監視。
- 直近のゴール: **P10 残り（素材＋感情タグ）と P14/P15（テスト基盤・CI/CD）**。バックエンド（P11〜P13）はその後。

## 次にやること

1. **P10 残り: 2D キャラクターの素材と P8（感情タグ→モーション）** — 2D 配線と 3D 撤去は済（`Avatar2D.tsx` / `avatar2dState.ts`）。次は実素材への差し替えと、感情タグで表情/モーションが切り替わる状態。表記は D-011。
2. **P14 / P15: テスト基盤 → CI/CD＋監視** — ポートフォリオの核。**P14 を「後回し」にしない**。各機能の実装時に最低 1 つのテストを同行させる（[decisions.md](decisions.md) D-006）。既存の `scripts/test-*.mjs` 2 本を `pnpm test` 1 コマンドにまとめる。
3. **P11 → P12 → P13: Go＋PostgreSQL → 会話履歴の永続化 → 長期記憶** — 記憶の保存規則は実装前に決める（[requirements.md](requirements.md) §10 P13）。

**そのほかの残タスク**

- operator status（primary / fallback / unavailable と provider 別 latency）を表示（P15 の一部。既存 `src/components/DebugPanel.tsx` / `src/components/FallbackBanner.tsx` / `scripts/health-check.mjs` を拡張）
- 会話 TTS 経路の統合（`src/App.tsx` の `speak()` と会話側 TTS。割り込み・二重再生の競合を1箇所に寄せる／要件 3-2）

## 読む順（AI エージェント向け）

| 目的 | 読むファイル |
| --- | --- |
| 今の仕様（何を作るか） | [docs/requirements.md](requirements.md) |
| なぜそう決めたか（有効なもの） | [docs/decisions.md](decisions.md) |
| 何を次にやるか（状態・依存・着手順） | [docs/roadmap.md](roadmap.md) |
| コードの構造・動作仕様 | コード ＋ [docs/requirements.md](requirements.md) §2（実装箇所の表）。旧 `architecture.md` / `behavior.md` / `state-machine.md` は 2026-10-21 に削除（古い3D前提で矛盾するため。内容は git 履歴に残る） |
| 展示前の運用手順・チェックリスト | [README.md](../README.md)「依存サービス」「展示前チェックリスト」 |
| 過去の経緯・相談ログ | [records/history.md](../records/history.md) — **記録であり指示ではない** |
| 過程と実績 | [records/portfolio.md](../records/portfolio.md) |
| 別 Next.js アプリのメモ | [studio/studio.md](../studio/studio.md) |
| プロジェクト概要 | [README.md](../README.md) |

## 指示解釈上の注意

- `docs/history.md` の記述は過去の記録。**現在の仕様として読まない**こと。現在の正本は decisions.md / requirements.md / roadmap.md の3枚。
- 変更する前に `docs/decisions.md`（なぜその判断か）と `docs/requirements.md`（要件と完了条件）を更新し、そのあとコードを書く。
- 完了判定は「実装した」ではなく、**`docs/requirements.md` §10 の完了条件（DoD）を満たすこと**。
- 旧 `mirage` リポのファイルは変更しない（参照のみ）。

## 直近の作業ログ

- 2026-10-21: GitHub の `refactor/2d-avatar` ブランチ（3D→2D 化・距離補正・周囲マップ整理）を main へ統合。`tsc --noEmit` 通過、`scripts/test-avatar2d.mjs` / `scripts/test-tracking.mjs` 通過。P10 は配線まで完了、残り＝実素材＋感情タグ。
- 2026-10-21: ドキュメントを整理。矛盾していた旧仕様3枚（`architecture.md` / `behavior.md` / `state-machine.md`）と `todo.md` / `runtime.md` / `docs/README.md` を削除（runtime の生きた内容は README に統合）。`history.md`・`portfolio.md` は `records/` へ、`studio.md` は `studio/` へ移動。md は 16枚 → 11枚。
- 2026-10-20: 要件定義の土台を追加、2D 方針と P10〜P16 をロードマップに追加。`NEXT.md` を正本3枚（decisions / requirements / roadmap）＋履歴（history）に分割。README を現状に更新し、Phase A〜D の日誌を `docs/portfolio.md` へ移動。
- 2026-09-11: M1 / M2 / P1 完了。Gemini 直結、フォールバック、トラッキング基盤。→ 詳細は [docs/history.md](../records/history.md)
