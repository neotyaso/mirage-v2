# 再開メモ（mirage-v2 / AI DJ）

> 最終更新: 2026-11-08
> ブランチ: `ai-dj`
> 現在の本線: **AI DJ / 3Dパフォーマー**（D-023）。レセプションは退役し、旧要件は `docs/legacy/` にアーカイブ。

## 今どこにいるか

- `/` が AI DJ ステージ。`dance.html` は互換エイリアス。
- `ShowAction` / `ShowState`、2曲（NEON DRIVE / PULSE）、停止フェード、ダッキング、拍位相、BPM 同期、歩行、ダンス核、Gemini Live MC が動く。
- ダンス核は `src/dance/dance.ts`。base groove に小節ごとの atom を重ね、style（cute / cool / hype / chill）と moves を LLM の `dance` ツールから指定する。
- ダンス核の純関数テスト `scripts/test-dance.mjs` を追加。`pnpm test` でトラッキングと一緒に走る。
- MC は出力専用（`capture:false`）。8小節ごとに `buildMcPrompt` を送り、必要なときだけ話す／ツールを呼ぶ。
- Studio の `/api/live/token` で短命トークンを発行。Studio が無い場合は MC OFFLINE でステージは動く。
- レセプションの会話 UI・2D キャラ・会話フローは削除済み。カメラ／表情／トラッキング／Studio 基盤は再利用資産として残している。
- 生成 special、本物の曲、観客入力、`nextBar` 量子化、リップシンクは未着手。

## 次にやること

1. **DJ-8 nextBar 量子化＋本物の曲** — `playTrack` / `stopMusic` / `dance` の開始を小節頭に合わせる。CC0 または許諾済みの曲を1曲入れ、ビートグリッドを手動で合わせる。
2. **DJ-9 残り** — `ShowState` / `ShowAction` / BPM 同期 / キュー計算を純関数に切り出してテストする。CI、30分稼働、latency、MC の発話回数を計測する。
3. **DJ-7 観客入力** — `useFaceDetection` の人数・表情を Director のプロンプトへ渡す。カメラなしでも動くようにする。
4. **DJ-6 MotionSource＋生成 special** — `ClipMotionSource` / `ProceduralMotionSource` を切り、生成モデルを1つ選んでサビだけ A/B する。
5. **DJ-10 キャラクター** — ロボット / VRM / 3D猫を決め、Retargeter・表情・リップシンクを入れる。

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

- 2026-11-08: ダンス核を実装。`src/dance/dance.ts` に base groove＋8 atom＋4 style の純関数を置き、`DanceStage.tsx` から GLTF の sanitize 済みボーンへ加算。Gemini の `dance` ツールに style / moves を追加。`scripts/test-dance.mjs` と `pnpm test` を追加し、ヘッドレス Chrome で腕・腰・spin の反映を確認。
- 2026-11-08: `ai-dj` ブランチを作成。`/` を AI DJ ステージへ切り替え。README / requirements / roadmap / NEXT を AI DJ 本線に書き換え、旧 requirements / roadmap を `docs/legacy/` にアーカイブ。レセプションの会話 UI・2D キャラ・会話フローを削除し、カメラ／表情／トラッキング／Studio 基盤を再利用資産として残した。D-022 を本線化し、D-023 を追加。
- 2026-11-06: AI DJ スパイク。ShowAction、MusicTransport、歩行、プロシージャル身体、Gemini Live MC/Director を接続。8小節 MC、6ツール、ミュート、モバイル UI を実装。

ダンスの「精度」は、たぶん2つに分けた方がいいです。
1. 拍との精度（ズレない）：BPM/拍グリッドでほぼ解決済み  
2. 見た目の精度（ダサくない）：振付・接地・重心・遷移の問題で、今ここが死んでます
一番効く順番はこれです。
1. 二重駆動をやめる
今は「Danceクリップ」＋「サイン波の手続き層」を同時に動かしています。  
これは関節がケンカして、浮く・捻れる・首が抜けるの原因になります。
- クリップ主体なら、手続き層は微小な揺れだけ
- 手続き主体なら、クリップの脚・体幹・首は切る
どちらかに寄せるだけでかなりマシになります。
2. サイン波をやめて「8カウントのポーズ表」にする
sin()で関節を揺らすのは、踊りではなく揺れです。  
最低限、
beat 1: 左に体重、右腕を上げる
beat 2: 沈む
beat 3: 右に体重、左腕を上げる
beat 4: 戻る
のようなポーズのキーフレームをJSONで持ち、拍に合わせて補間する。  
これで「振付」になります。4拍ではなく8拍・16拍で組むと踊りに見えます。
3. 足を固定する（一番デカい）
今のモデルは Foot.L/R が脚とは別ボーンなので、脚を曲げると足が置いてけぼりになります。  
なので、
- 支持足のFootボーンを床に固定
- 膝の向きを合わせる
- 腰の高さを足に合わせて下げる
という簡易IKが必要です。これがないと、どんなにポーズを良くしても浮いて見えます。
4. 重心移動とタメを作る
- 踏む前に逆側へ体重を預ける（anticipation）
- 着地で少し沈む
- 腕は胴より0.1〜0.2拍遅れて追従
- ポーズの終わりに小さくオーバーシュートして戻す
これを入れるだけで一気に人間っぽくなります。
5. 小節の継ぎ目を補間する
小節頭でポーズを切り替えるとカクッとします。  
前のポーズから0.1〜0.2拍かけてクロスフェードすると滑らかになります。
6. 曲ごとに8小節単位で振付を割る
ピアノ曲はBPMが固定でもフレーズが違います。  
完全ランダムや手続きだけでは限界があるので、
- 8小節ごとのセクション
- 各セクションにポーズ列を割り当て
- サビだけ動きを大きくする
のが現実的です。
7. 数値で見る
固定カメラで動画を撮って、
- 足の滑り距離
- 拍とのズレ
- 関節角の急変
- 同じ動きの繰り返し率
を見ると、目視より速く直せます。
一番早く品質を上げるなら、CC0/Mixamoのモーキャプ振付を1つ入れて拍同期するのが最短です。  
手続きで作るなら、次は「8カウントのポーズ表＋簡易足IK」を実装するのが一番効きます。
今のコードなら、次は choreo.ts にポーズ表を作って、sampleDance をサイン波からキーフレーム補間に置き換えるのが第一歩です。  
足IKはその次。まだ実装はしていません。
