# 要件定義（正本） — AI DJ / 3Dパフォーマー

> 最終更新: 2026-11-08
> 本線: **AI DJ / 3Dパフォーマー**（D-023）。レセプション本線は退役し、当時の要件は [legacy/reception-requirements.md](legacy/reception-requirements.md) にアーカイブした。
> 関連: 決定は [decisions.md](decisions.md)、着手順は [roadmap.md](roadmap.md)、設計の詳細は [ai-dj-architecture.md](ai-dj-architecture.md)。

## 0. このファイルの使い方

- 実装対象は `mirage-v2`（D-001）。
- 新しい要件は「§3 機能要件」に足し、実装対象になったら [roadmap.md](roadmap.md) に `DJ-*` の番号を振る。
- 方針が変わったときは [decisions.md](decisions.md) に決定を追加し、古い記述は [history.md](../records/history.md) へ移す。
- レセプション時代の P 番号・要件は現在の完了判定に使わない（アーカイブ参照）。

## 1. プロジェクト概要

Mirage は、LLM が状況を考え、音楽に合わせて 3D キャラクターが踊り、MC として話す **AI DJ / 3Dパフォーマー**。

看板は Text-to-Motion ではない。Text-to-Motion は「特別な見せ場」を作る内部部品として扱う。LLM は 60fps の関節生成器ではなく、**公演を判断するディレクター**である。

### 1.1 北極星

目の前の観客と音楽に合わせて、**その場で考えて踊り、喋り、間を取り、次の展開を選ぶ**パフォーマー。

### 1.2 今回のスコープ

- 1ステージ・1体の 3D キャラクター。
- 2曲のシンセ音源（NEON DRIVE / PULSE）と BPM 同期。
- ダンス、停止、曲変更、歩行、トーク、ジェスチャーの公演アクション。
- Gemini Live による日本語 MC（出力専用）。
- デスクトップ／モバイルのステージ UI。
- Studio の短命トークン経由で接続し、ブラウザに API キーを置かない。

### 1.3 今回やらないこと

- LLM が毎フレーム関節角度を出すこと。
- 完成した振付を大量に持って、その中から選ぶだけの構成。
- 映像生成モデルを 3D ステージに直接混ぜること。
- 本物の楽曲ライセンス、複数ステージ、複数キャラクターの同時運用。
- AI の長期記憶・来場者アカウント（D-012）。
- レセプション UI の復活。

## 2. 現在の実装状況

| 項目 | 現状 | 実装箇所 |
| --- | --- | --- |
| エントリ | `/` が AI DJ ステージ。`/dance.html` は互換エイリアス | `index.html` / `dance.html` / `src/dance/main.tsx` |
| 3D ステージ | Three.js、Mixamo の人間キャラ、Bloom、粒子、レスポンシブ | `src/dance/DanceStage.tsx` |
| 公演状態 | `ShowAction` / `ShowState`、2曲、ステージマーク | `src/dance/show.ts` |
| 音楽 | Web Audio シンセ2曲、停止フェード、ダッキング、拍位相、BPM | `src/dance/audio.ts` |
| 身体 | Mixamo の Michelle＋モーションキャプチャのダンス。style ごとにクリップを選び、BPM に `timeScale` を合わせる | `src/dance/mixamo.ts` / `src/dance/DanceStage.tsx` |
| 歩行 | `center / left / right / front` へルート移動。到着後に Idle / Dance へ戻る | `src/dance/DanceStage.tsx` |
| MC / Director | Gemini Live のコードは残るが、現在は未接続（ダンスのみ）。DJ 人格・8小節ごとの判断・ツール実行は休眠 | `src/dance/mc.ts` / `src/hooks/useGeminiLive.ts` |
| 観客入力 | 未接続。カメラ・表情・トラッキングの資産は残している | `src/hooks/useFaceDetection.ts` / `src/vision/expression.ts` / `src/tracking/` |
| Studio | Live 短命トークン、検索・天気・vision の API 中継 | `studio/app/api/` |
| 生成 special | 未着手 | — |
| テスト | トラッキング、Mixamo GLB、旧ダンス核の自己テスト | `scripts/test-tracking.mjs` / `scripts/test-mixamo.mjs` / `scripts/test-dance.mjs` |

## 3. 機能要件

### 3-1. Director（LLM）

- LLM は公演の**ディレクター**であり、身体の 60fps ループには入らない。
- 判断は 1〜2 小節ごとを目標にする。現在は MC チャンスが 8 小節ごと。
- 入力: 公演状態（モード、曲、BPM、小節、拍、再生中）、音楽の energy / section、観客の人数・表情（将来）、直前の発話。
- 出力: モデル非依存の `ShowAction`（`dance` / `stopMusic` / `playTrack` / `walkTo` / `talk` / `gesture`）。
- 話さない判断は「ツールを呼ばず、音声も出さない」で表現する。`silence` ツールは作らない（呼び出しループの原因になった）。
- 判断が遅れても身体と音楽は止めない。前の cue を続ける。
- 失敗時はステージを止めず、MC OFFLINE として続行する。

### 3-2. MusicTransport

- 曲の再生・停止・切り替えを管理する。
- BPM、拍、小節、拍内位相、energy、section（intro / build / drop / break / outro）を身体側へ渡す。
- 発話中は音楽をダッキングする。現在はゲインを 0.28 に下げる。
- 停止はフェードで行い、身体は Idle へクロスフェードする。
- 曲変更・停止は `nextBar` での量子化を目標にする。現在は即時実行。
- 音楽はブラウザ内で完結させる。外部 API キーをブラウザに置かない。

### 3-3. Body Performance

身体は次の4レイヤーに分ける。

| レイヤー | 役割 | 音楽依存 |
| --- | --- | --- |
| Locomotion | Mixamo の `Walking` とルート移動で歩く・向き直る | なし |
| Dance | Mixamo のモーションキャプチャ（hype / cool / cute / chill） | あり |
| Gesture | MC 用のジェスチャーは休止中 | なし |
| Face | 表情・視線・リップシンクは未実装 | なし |

- 現在は **モーションキャプチャのクリップ主体**。旧 `dance.ts` の procedural サンプラーはステージから未使用（MC ツール用の型・検証だけ残す）。
- style はクリップに対応する: hype=`Robot_Hip_Hop_Dance` / cool=`Breakdance_Uprock` / cute=`Jazz_Dancing` / chill=`House_Dancing`。
- BPM 同期は `AnimationAction.timeScale = bpm / クリップ本来のBPM`（0.8〜1.25 にクランプ）。
- 横方向の Hips ルートモーションは 0 にして、ステージ中央で踊らせる。上下のバウンスはクリップに任せる。
- 歩行は `Walking` クリップ＋ルート移動。到着後は Dance / Idle へ戻る。
- 生成モデルは将来 `MotionSource` の裏に隠し、後から差し替え可能にする。
- **既知の制限**: 歩行は直線移動＋到着後の向き直しのみ。ダンスの足は読み込み時に接地を正規化するが、クリップごとの足滑り補正・障害物回避・表情・ジェスチャーは未実装。

### 3-4. MC / Voice

- Gemini Live のネイティブ音声を使う。声は Zephyr 固定。
- **出力専用**（`capture:false`）で開始する。スピーカーの音楽をマイクが拾うハウリングを避ける。
- 1回の発話は 2〜6 秒。長話・自己紹介の連発をしない。
- 曲が鳴っている間は MC のチャンスを限定し、盛り上がり中・ドロップ中は黙ってよい。
- 曲紹介、観客の煽り、次の展開の予告、動きの説明のどれかを短く話す。
- 舞台操作は必ずツールで実行する。発話だけして身体が動かない状態を作らない。
- 発話中は音楽をダッキングする。
- マイク入力・観客との双方向会話は将来の拡張。入れる場合は音楽の回り込み対策を先に設計する。

### 3-5. 公演フロー

観客から見える1本の流れ:

```
接近 → 音楽開始 → ダンス
     → 盛り上がりを見て発言 → ドロップ
     → 音楽停止 → トーク → 歩く → 次の曲 → ダンス
```

- いつ止めるか、いつ話すか、どこへ歩くか、次にどの曲をかけるかは Director が決める。
- 人が操作する場合も、同じ `ShowAction` を通す。UI のボタンは Director の代役であり、別経路を作らない。
- 公演中の曲停止・曲変更で身体が固まらない。

### 3-6. 観客・カメラ入力（将来）

- カメラで人数・顔の位置・表情を取得し、Director の入力に使う。
- 観客が多い・笑顔が多い・盛り上がっている、を music energy と合わせて解釈する。
- 画像・顔特徴量は保存しない。Studio のライブ監視は最新1枚の上書きのみ（D-020 / D-021）。
- カメラが落ちても公演は続ける。観客入力は「あれば嬉しい」依存にする。

### 3-7. UI / 運用

- ステージ上に現在のモード、曲、BPM、小節を表示する。
- MC の発話をテキストでも表示する。
- `dance` / `stop_music` / `play_track` / `walk` / `talk` / `gesture` のクイック操作を用意する。
- MC と音楽のミュートを個別に切り替えられる。
- モバイルでもステージと操作が破綻しない。
- Studio が落ちている場合は「MC OFFLINE」と明示し、ステージ操作は継続する。

### 3-8. セキュリティ・プライバシー

- API キーは `studio/.env` に置く。ブラウザには Live 用の短命トークンだけ渡す（D-018）。
- ブラウザから外部 API を直接叩かない。Studio の API Route を経由する。
- カメラ画像はメモリ上で縮小して送るだけ。保存しない。
- 展示端末は LAN 内に置く。管理 API を公衆網に晒さない。

## 4. 非機能要件

### 4.1 レイテンシ

- 身体: 60fps を維持する。
- LLM の判断: 1小節以内（112 BPM で約 2.1 秒）を目標。
- 発話開始: 1小節以内を目標。
- 生成 special: 2〜4 秒先読み。間に合わなければ atom に落とす。
- フォールバック: 即時。ステージを止めない。

### 4.2 安定性

- 生成や LLM の失敗で音楽・身体を止めない。
- 曲停止・変更・歩行の途中で状態機械が詰まらない。
- Studio 停止時もステージ操作は動く。
- 30分連続稼働を目標に、メモリ・タイマー・AudioContext のリークを確認する。

### 4.3 テスト

- 公演状態機械、BPM 同期、キュー量子化、Director の出力変換は純関数に分け、ブラウザ無しでテストする。
- 外部 API（Gemini / Studio）をモックした統合テストを入れる。
- 実機カメラ・マイクがなくてもビルドと主要ロジックを検証できるようにする。
- 現状は `scripts/test-tracking.mjs` と `scripts/test-dance.mjs`。`pnpm test` で両方実行する。公演状態機械・BPM 同期・キュー量子化のテストは `DJ-9` で追加する。

### 4.4 計測

- 判断 latency、発話開始 latency、フレームレート、曲停止・変更の成功率を記録する。
- MC の発話回数と沈黙回数をログに残し、喋りすぎを測る。
- 生成 special の生成時間・失敗率・差し込み成功率を記録する。

## 5. 実装場所

| ファイル | 内容 |
| --- | --- |
| `src/dance/DanceStage.tsx` | Three.js シーン、公演状態、歩行、ボーン適用、UI、MC 接続 |
| `src/dance/dance.ts` | ダンス核。拍・小節・style・moves から姿勢を返す純関数 |
| `src/dance/show.ts` | `ShowAction` / `ShowState`、曲、ステージマーク |
| `src/dance/audio.ts` | シンセ2曲、停止フェード、ダッキング、拍位相、BPM |
| `src/dance/mc.ts` | DJ プロンプト、Gemini Live ツール、MC プロンプト |
| `src/dance/dance.css` | ステージ UI |
| `src/hooks/useGeminiLive.ts` | Live 接続、カスタムプロンプト／ツール、`capture:false`、`prompt()`、ミュート |
| `src/hooks/useFaceDetection.ts` | 顔検出・距離・表情（観客入力の再利用資産） |
| `src/vision/expression.ts` | 表情スコアの解釈 |
| `src/tracking/` | 通行人トラッキングとイベントログ（再利用資産） |
| `studio/app/api/live/token/route.ts` | Live 用短命トークン |
| `public/models/mixamo/` | Mixamo の Michelle＋ダンスクリップ（出典・ライセンスは同ディレクトリの README） |

## 6. 完了条件（DoD）

### 現在の本線（2026-11-12）

- [x] `/` で AI DJ ステージが起動する。
- [x] Mixamo の Michelle がステージ中央に立ち、足が床に接地している。
- [x] 4 style の Mixamo ダンスクリップが BPM に追従してループする。
- [x] 曲停止で Idle、歩行で Walking、到着後に Dance / Idle へ戻る。
- [x] Mixamo アセットの出典・ライセンスを記録した。
- [x] `pnpm build` と `pnpm test` が通る。
- [ ] 本物の曲と `nextBar` 量子化。
- [ ] 表情・リップシンク・ジェスチャー。

### 前のマイルストーン（2026-11-08 / 履歴）

- [x] `/` で AI DJ ステージが起動する。
- [x] `dance` / `stop_music` / `play_track` / `walk` / `talk` / `gesture` が動く。
- [x] ダンス → 停止 → トーク → 歩行 → 次の曲 → ダンス の1巡が通る。
- [x] BPM 同期の base groove と、小節ごとの atom が動く。
- [x] LLM の `dance` ツールが style / moves / energy を指定し、身体に反映される。
- [x] Gemini Live の MC が話し、ツールで舞台を操作する。
- [x] Studio が落ちてもステージ操作は動く。
- [x] `pnpm build`（`tsc --noEmit && vite build`）が通る。
- [x] レセプションの会話 UI・2D キャラを本線から削除した。
- [x] 旧要件・旧ロードマップを `docs/legacy/` にアーカイブした。

### DJ-6 MotionSource / 生成 special

- [ ] モーション再生を `MotionSource` の裏に分離する。
- [ ] `ClipMotionSource` と `ProceduralMotionSource` を差し替え可能にする。
- [ ] 生成モデルを1つ選び、オフラインで1曲分を生成する。
- [ ] サビ前に先読みし、間に合わなければ atom に落ちる。
- [ ] atom と生成 special を A/B 比較する。

### DJ-7 観客入力

- [ ] カメラから人数・表情・動きを取得し、Director の入力に渡す。
- [ ] 観客入力が落ちても公演が続く。
- [ ] 画像・顔特徴量を保存しないことをテストで確認する。

### DJ-8 音楽・キュー・リップシンク

- [ ] 本物の曲（CC0 または許諾済み）を再生できる。
- [ ] `nextBar` で曲変更・停止・ダンス開始を量子化する。
- [ ] ビート解析または手動ビートグリッドで拍位相を安定させる。
- [ ] 発話に合わせた口パクを入れる。

### DJ-9 品質・テスト

- [x] ダンス核（拍・小節・style・atom）の純関数テストを追加し、`pnpm test` で実行する。
- [ ] 公演状態機械・BPM 同期・キュー量子化の純関数テストを追加する。
- [ ] CI を整備する。
- [ ] 30分連続稼働、曲停止・変更の成功率、MC の発話回数を計測する。
- [ ] 実機スピーカー／マイクで回り込みを確認する。

### DJ-10 キャラクター

- [x] Mixamo の Michelle＋モーションキャプチャのダンスに決める。
- [x] 標準 Mixamo リグのクリップをそのまま再生できる。
- [ ] Retargeter を調整する（VRM / 生成モーションへ移すとき）。
- [ ] 表情・視線・リップシンクを追加する。

## 7. 未確定の項目

| 項目 | まだ決まっていないこと | 決めるタイミング |
| --- | --- | --- |
| MC の判断周期 | 8小節のままか、4小節・1小節へ短くするか | 観客入力と nextBar の実装時 |
| 生成モデル | TM2D / FlowerDance / EDGE のどれか | DJ-6 |
| 音楽 | シンセのままか、CC0 か、生成音楽か | DJ-8 |
| キャラクター | Mixamo Michelle に決定。表情・視線の実装方法が未定 | DJ-10 |
| 観客入力の重み | 人数・表情・動きをどう energy に変換するか | DJ-7 |
| 音響 | スピーカーとマイクの回り込みをどう避けるか | 実機試験 |
| 90/10 の比率 | 最初の実測で見直す | 生成 special の A/B 後 |
| テスト | DJ の合格基準・負荷条件 | DJ-9 |
