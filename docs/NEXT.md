# 再開メモ（mirage-v2 / AI DJ）

> 最終更新: 2026-11-12
> ブランチ: `ai-dj`
> 現在の本線: **AI DJ / 3Dパフォーマー**（D-023）。レセプションは退役し、旧要件は `docs/legacy/` にアーカイブ。

## 今どこにいるか

- `/` が AI DJ ステージ。`dance.html` は互換エイリアス。
- 身体は **Mixamo の Michelle ＋ モーションキャプチャのダンスクリップ**。`src/dance/mixamo.ts` が読み込み・BPM 追従・クロスフェード・接地正規化を持つ。`RobotExpressive.glb` と手続きダンス層はステージから外した。
- `ShowAction` / `ShowState`、Pixabay の無料楽曲「Dance Electro 120 bpm」1曲、停止フェード、ダッキング、拍位相、BPM 同期、歩行が動く。
- ダンスクリップは `Robot_Hip_Hop_Dance`（hype）/ `Breakdance_Uprock`（cool）/ `Jazz_Dancing`（cute）/ `House_Dancing`（chill）。`src/dance/dance.ts` の手続きサンプラーは未使用で、style/moves の型と `mergeDanceCue` だけ MC ツール用に残している。
- ビートグリッドは **120 BPM / 先頭ダウンビート 0.987s / 60小節**。`show.ts` の `sectionAtBar` が intro / build / drop / break / outro を返し、`DanceStage` が小節頭でセクションのクリップへ切り替える。`playTrack` / `stopMusic` / `dance` は次の小節頭に量子化する。
- `scripts/test-mixamo.mjs` で GLB、`scripts/test-audio.mjs` で音源、`scripts/test-sections.mjs` でビートグリッドとセクション割りを確認。`scripts/test-dance.mjs` は旧手続き核のテストとして残っている。
- Gemini Live MC は現在**接続していない**。`useGeminiLive` とツールは残しているが、`startSession` から `connect()` しない。ステージはダンスのみ。
- レセプションの会話 UI・2D キャラ・会話フローは削除済み。カメラ／表情／トラッキング／Studio 基盤は再利用資産として残している。
- 生成 special、観客入力、任意曲の自動ビート解析、オンセット連動のアクセント、表情・リップシンクは未着手。

## 次にやること

1. **DJ-8 残り** — キック／スネア／オンセットに合わせた首・腕・ライト・カメラのアクセントを足す。任意曲を入れる段階で自動ビート解析も検討する。
2. **DJ-9 残り** — `ShowState` / `ShowAction` / BPM 同期 / キュー計算を純関数に切り出してテストする。CI、30分稼働、latency、MC の発話回数を計測する。
3. **DJ-7 観客入力** — `useFaceDetection` の人数・表情を Director のプロンプトへ渡す。カメラなしでも動くようにする。
4. **DJ-6 MotionSource＋生成 special** — `ClipMotionSource` / `ProceduralMotionSource` を切り、生成モデルを1つ選んでサビだけ A/B する。
5. **DJ-10 表情・リップシンク** — Mixamo Michelle は導入済み。表情・視線・Retargeter を入れる。

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

- 2026-11-12: 曲の解析から **先頭ダウンビート 0.987s / 120 BPM / 60小節** のビートグリッドを `show.ts` に持たせ、`DanceAudio` の拍・小節をこの頭出しに合わせた。`sectionAtBar` で intro / drop / break / build / outro を引き、`DanceStage` が小節頭でセクションのクリップへ切り替える。`playTrack` / `stopMusic` / `dance` は次の小節頭まで待って実行。ヘッドレス Chrome で 8/16/24小節の切替と、停止が小節線に乗ることを確認。`scripts/test-sections.mjs` を追加。
- 2026-11-12: 音楽を Web Audio シンセ2曲から **Pixabay の無料楽曲「Dance Electro 120 bpm - Full」（120 BPM）** に差し替え。`DanceAudio` は MP3 を `AudioBufferSourceNode` でループ再生し、BPM から拍位相を作る。出典・ライセンスは `public/audio/README.md`、`scripts/test-audio.mjs` を追加。
- 2026-11-12: ステージの身体を **Mixamo の Michelle＋モーションキャプチャのダンス**へ置き換え。`RobotExpressive.glb` と手続きダンス層をステージから外し、`src/dance/mixamo.ts` で BPM 追従・クロスフェード・接地正規化・横方向ルートモーション除去を実装。`public/models/mixamo/` に出典を記録し、`scripts/test-mixamo.mjs` を追加。ヘッドレス Chrome でダンス中の見た目と JS エラーなしを確認。
- 2026-11-08: ダンス核を実装。`src/dance/dance.ts` に base groove＋8 atom＋4 style の純関数を置き、`DanceStage.tsx` から GLTF の sanitize 済みボーンへ加算。Gemini の `dance` ツールに style / moves を追加。`scripts/test-dance.mjs` と `pnpm test` を追加し、ヘッドレス Chrome で腕・腰・spin の反映を確認。
- 2026-11-08: `ai-dj` ブランチを作成。`/` を AI DJ ステージへ切り替え。README / requirements / roadmap / NEXT を AI DJ 本線に書き換え、旧 requirements / roadmap を `docs/legacy/` にアーカイブ。レセプションの会話 UI・2D キャラ・会話フローを削除し、カメラ／表情／トラッキング／Studio 基盤を再利用資産として残した。D-022 を本線化し、D-023 を追加。
- 2026-11-06: AI DJ スパイク。ShowAction、MusicTransport、歩行、プロシージャル身体、Gemini Live MC/Director を接続。8小節 MC、6ツール、ミュート、モバイル UI を実装。

> 以下はロボット＋手続き層だった頃の改善メモ。2026-11-12 に Mixamo のモーションキャプチャへ置き換え済み。現在のダンスはクリップ主体で、このメモの「二重駆動をやめる」「足を固定する」は解消済み。
