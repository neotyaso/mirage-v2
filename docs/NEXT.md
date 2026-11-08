# 再開メモ（mirage-v2 / AI DJ）

> 最終更新: 2026-11-08
> ブランチ: `ai-dj`
> 現在の本線: **AI DJ / 3Dパフォーマー**（D-023）。レセプションは退役し、旧要件は `docs/legacy/` にアーカイブ。

## 今どこにいるか

- `/` が AI DJ ステージ。`dance.html` は互換エイリアス。
- `ShowAction` / `ShowState`、2曲（NEON DRIVE / PULSE）、停止フェード、ダッキング、拍位相、BPM 同期、歩行、プロシージャル身体、Gemini Live MC が動く。
- MC は出力専用（`capture:false`）。8小節ごとに `buildMcPrompt` を送り、必要なときだけ話す／ツールを呼ぶ。
- Studio の `/api/live/token` で短命トークンを発行。Studio が無い場合は MC OFFLINE でステージは動く。
- レセプションの会話 UI・2D キャラ・会話フローは削除済み。カメラ／表情／トラッキング／Studio 基盤は再利用資産として残している。
- 生成 special、本物の曲、観客入力、`nextBar` 量子化、リップシンクは未着手。

## 次にやること

1. **DJ-9 テストの土台** — `ShowState` / `ShowAction` / BPM 同期 / キュー計算を純関数に切り出し、`scripts/` の自己テストを追加する。次の変更を壊さないため、先にここを固める。
2. **DJ-8 nextBar 量子化＋本物の曲** — `playTrack` / `stopMusic` / `dance` の開始を小節頭に合わせる。CC0 または許諾済みの曲を1曲入れ、ビートグリッドを手動で合わせる。
3. **DJ-7 観客入力** — `useFaceDetection` の人数・表情を Director のプロンプトへ渡す。カメラなしでも動くようにする。
4. **DJ-6 MotionSource＋生成 special** — `ClipMotionSource` / `ProceduralMotionSource` を切り、生成モデルを1つ選んでサビだけ A/B する。
5. **DJ-10 キャラクター** — ロボット / VRM / 3D猫を決め、Retargeter・表情・リップシンクを入れる。
6. **DJ-9 品質** — `pnpm test` と CI、30分稼働、latency、MC の発話回数を計測する。

## 読む順（AI エージェント向け）

| 目的 | 読むファイル |
| --- | --- |
| 今の仕様 | [requirements.md](requirements.md) |
| なぜそう決めたか | [decisions.md](decisions.md) |
| 何を次にやるか | [roadmap.md](roadmap.md) |
| AI DJ の設計 | [ai-dj-architecture.md](ai-dj-architecture.md) |
| コードの構造 | `src/dance/` と [requirements.md](requirements.md) §5 |
| 過去の経緯 | [history.md](../records/history.md) |
| レセプション時代 | [legacy/](legacy/) |

## 指示解釈上の注意

- `records/history.md` は過去の記録。現在の仕様として読まない。正本は `requirements.md` / `decisions.md` / `roadmap.md`。
- レセプション時代の P 番号・要件は現在の完了判定に使わない。`DJ-*` を使う。
- `docs/legacy/` は当時の資料。現在の仕様ではない。
- LLM に 60fps の関節を出させない。判断は 1〜2小節、身体は 60fps、音楽は拍。
- 生成モデルを入れるときも、失敗時は atom に落として公演を止めない。
- API キーをブラウザに置かない。Studio の短命トークンを使う（D-018）。
- `silence` ツールを復活させない。沈黙は「ツールを呼ばず、音声も出さない」で表現する。
- 変更する前に `decisions.md` と `requirements.md` を更新し、そのあとコードを書く。

## 直近の作業ログ

- 2026-11-08: `ai-dj` ブランチを作成。`/` を AI DJ ステージへ切り替え。README / requirements / roadmap / NEXT を AI DJ 本線に書き換え、旧 requirements / roadmap を `docs/legacy/` にアーカイブ。レセプションの会話 UI・2D キャラ・会話フローを削除し、カメラ／表情／トラッキング／Studio 基盤を再利用資産として残した。D-022 を本線化し、D-023 を追加。
- 2026-11-06: AI DJ スパイク。ShowAction、MusicTransport、歩行、プロシージャル身体、Gemini Live MC/Director を接続。8小節 MC、6ツール、ミュート、モバイル UI を実装。
