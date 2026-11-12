# AI DJ / 3D Performance Architecture

> 最終更新: 2026-11-12  
> 状態: **本線**。`/`（`dance.html` は互換エイリアス）で ShowAction、MusicTransport、歩行、Mixamo の人間キャラ＋Mocapダンスまで接続。Gemini Live MC/Director はコードを残して休止中。  
> 現状: 音は2パターンのシンセ、身体は Mixamo の Michelle＋モーションキャプチャのダンス。生成special・本物の曲・観客入力・表情・リップシンクは未着手。  
> 関連: 要件は [requirements.md](requirements.md)、着手順は [roadmap.md](roadmap.md)、決定は [decisions.md](decisions.md)（D-022 / D-023）。

---

## 0. 結論

- 看板は **Text-to-Motion ではない**。プロダクトは **AI DJ / 3Dパフォーマー**。
- LLMは60fpsの関節を生成しない。**LLMは振付・発言・選曲を判断するディレクター**。
- 身体は **Locomotion / Dance / Gesture / Face** のレイヤーで動かす。
- モーションは **90%: atom＋プロシージャル**、**10%: 生成モデルの特別枠**。
- モデルは `MotionSource` の裏に隠し、後から差し替え可能にする。
- 音楽は `MusicTransport`、発話はMCループとして分離する。

---

## 1. プロダクト定義

### 1.1 何を作るか

**会話し、状況を見て、音楽で踊り、途中で止まって喋り、歩き、次の曲を選ぶ3Dパフォーマー。**

観客から見える1本の流れ:

```
接近 → 会話 → 音楽開始 → ダンス
     → 盛り上がりを見て発言 → ドロップ
     → 音楽停止 → トーク → 歩く → 次の曲 → ダンス
```

### 1.2 何を目指さないか（初期実装）

- LLMが毎フレーム関節角度を出すこと
- 完成した振付を何パターンも持って、その中から選ぶだけの構成
- 映像生成モデル（Wan-Dancer等）を3Dステージに直接混ぜること
- 最初から完全な人体ダンス生成を成立させること

### 1.3 用語

| 用語 | 意味 |
| --- | --- |
| **Director** | LLM。会話・状況・音楽から、発言と演技を決める |
| **ShowAction** | Directorが出す公演レベルの指示（曲、停止、歩く、喋る） |
| **Cue** | 身体への演技指示（スタイル、エネルギー、長さ） |
| **atom** | 0.5〜2秒の短い動きの部品。完成振付ではない |
| **procedural** | 拍・重心・呼吸など、毎フレーム生成するベースモーション |
| **special** | 10%枠の生成モーション。サビなど限定使用 |
| **MotionSource** | モーション生成の差し替え可能な実装 |
| **Retargeter** | SMPL / Mixamo / VRM / ロボット間の骨格変換 |
| **MusicTransport** | 曲の再生・停止・クロスフェード・ビート管理 |

---

## 2. Text-to-Motion と Dance の違い

似ているが、解いている問題が違う。

| 分類 | 入力 | 出力 | 主な課題 | 代表 |
| --- | --- | --- | --- | --- |
| Text-to-Motion | テキスト | 3D人体動作 | 意味を動作に変換 | MDM / MoMask++ / SnapMoGen |
| Music-to-Dance | 音楽 | 3Dダンス | 音楽と動作の同期 | FlowerDance / Bailando / EDGE |
| Text + Music-to-Dance | テキスト＋音楽 | 3Dダンス | 同期＋スタイル制御 | TM2D |
| Image + Music → Video | 画像＋音楽 | ダンス動画 | 見栄え（3Dではない） | Wan-Dancer |

### 2.1 Mirageでの使い分け

- **会話中の仕草** → Text-to-Motion 系、またはatom
- **音楽に合わせたダンス** → Music-to-Dance 系。テキストはスタイル指定
- **特別な見せ場** → 生成モデル。事前に2〜4秒かけて生成して差し込む
- **歩く・立つ・向き直る** → Locomotion。ダンスとは別レイヤー

**「歩く」をダンスのatomで済ませないこと。** 音楽が止まった後も自然に動けるように、Locomotionを独立させる。

---

## 3. 全体アーキテクチャ

```
                    ┌─────────────────────────┐
                    │  Director (LLM)          │
                    │  Gemini Live / local     │
                    │  会話・状況・選曲・発言   │
                    └───────────┬─────────────┘
                                │ ShowAction / Cue
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
     ┌────────────────┐  ┌──────────────┐  ┌──────────────┐
     │ MusicTransport │  │ Body         │  │ MC Voice     │
     │ 曲/停止/同期    │  │ Performance  │  │ 発話/ダッキング│
     └────────┬───────┘  └──────┬───────┘  └──────┬───────┘
              │ MusicState      │ Pose            │ speaking
              └─────────────────┼─────────────────┘
                                ▼
                    ┌─────────────────────────┐
                    │ Retargeter              │
                    │ SMPL / VRM / Robot      │
                    └───────────┬─────────────┘
                                ▼
                        3D Character
```

### 3.1 Director（LLM）

- 会話、カメラ、音楽、前回の発言、公演状態を見る
- **ShowAction** と **Cue** を出す
- 発話するか黙るかも決める
- 60fpsループには入らない。1〜2小節ごとの判断に限定する

### 3.2 MusicTransport

- 曲の再生・停止・クロスフェード
- BPM、拍、小節、セクション（intro/build/drop/break）
- 発話時のダッキング
- ビートグリッドを身体側へ渡す

### 3.3 Body Performance

4レイヤーで構成する。

| レイヤー | 役割 | 音楽依存 | 主な実装 |
| --- | --- | --- | --- |
| Locomotion | 歩く・立つ・向き直る・マークへ移動 | なし | 歩行クリップ＋ルート移動、またはモーションマッチング |
| Dance | 音楽に合わせた全身ダンス | あり | atom＋procedural / 生成モデル |
| Gesture | 手振り・うなずき・指差し | なし | 上半身additive、または短いクリップ |
| Face | 表情・視線・口パク | なし | モーフ／ボーン／テクスチャ |

Danceは全身。Walk中はLocomotionが下半身を担当し、Gestureを上半身に重ねる。Talkは立ち止まるか歩きながら上半身で表現する。

### 3.4 MC Voice

- Gemini Liveの音声をそのまま使う
- 発話中は音楽をダッキング
- 拍に正確に合わせたい台詞だけTTSをキューに積む
- 詳細は §8

### 3.5 Retargeter

- 生成モデルの出力（SMPL等）をキャラクターの骨格へ変換
- キャラクターを変えても、モーション生成側は変えない
- ロボットは人型骨格なのでリターゲット可能。四足の3D猫は別問題

### 3.6 MotionSource

モーション生成の差し替え口。LLMもUIも、特定モデルを知らない。

```ts
interface MotionSource {
  readonly id: string;
  readonly capabilities: {
    styles: string[];
    supportsText: boolean;
    supportsMusic: boolean;
    latency: "instant" | "buffered";
  };
  play(cue: Cue, music: MusicState): void;
  update(dt: number, music: MusicState): void;
  dispose(): void;
}
```

実装候補:

- `ClipMotionSource` — 今のクリップ再生
- `ProceduralMotionSource` — 拍・重心・腕の層
- `MotionMatchingSource` — モーキャプDBから毎フレーム検索
- `TM2DSource` / `FlowerDanceSource` — 生成モデル
- `StreamingMotionSource` — 研究枠

---

## 4. 3つの時計とレイテンシ

| 時計 | 周期 | 担当 | 内容 |
| --- | --- | --- | --- |
| 思考クロック | 0.5〜4秒 / 1〜2小節 | LLM | 何を、どの強さで、いつ、誰に |
| 身体クロック | 60fps | モーションエンジン | 関節、重心、ブレンド、IK |
| 音楽クロック | 拍・小節 | MusicTransport | BPM、拍位相、セクション |

### 4.1 レイテンシ目標

- LLMの判断: **1小節以内**（112 BPMなら約2.1秒）
- 発話開始: **1小節以内**
- 生成special: **2〜4秒先読み**。間に合わなければatom
- フォールバック: **即時**。ステージを止めない

### 4.2 原則

- LLMにフレーム単位の関節を出させない
- 生成モデルの完了を待って音楽を止めない
- 判断が遅れたら、身体は前のcueを続ける
- 失敗は「止まる」ではなく「atomに落ちる」

---

## 5. データ契約

### 5.1 MusicState

```ts
type MusicState = {
  playing: boolean;
  trackId: string;
  bpm: number;
  bar: number;
  beat: number;       // 0..3
  phase: number;      // 0..1（拍内）
  energy: number;     // 0..1
  section: "intro" | "build" | "drop" | "break" | "outro";
};
```

### 5.2 Cue

```ts
type Cue = {
  intent: "dance" | "gesture" | "idle";
  style: string;
  energy: number;     // 0..1
  bars: number;
  description?: string; // 生成モデル用。atomは無視してよい
  accents?: string[];
};
```

`description` を最初から持たせておく。今のatomは無視するが、後でTM2DやFlowerDanceを差したときにLLMの意図をそのまま渡せる。LLM側を書き直さずに済む。

### 5.3 ShowAction

```ts
type ShowAction =
  | { type: "playTrack"; trackId: string; at: "nextBar" | "now" }
  | { type: "stopMusic"; fadeBars: number; hard?: boolean }
  | { type: "walkTo"; mark: "center" | "left" | "right" | "front" }
  | { type: "talk"; topic?: string }
  | { type: "dance"; cue: Cue }
  | { type: "gesture"; intent: "wave" | "nod" | "point" | "celebrate" };
// 沈黙はShowActionではなく、MCが「ツールを呼ばず音声も出さない」で表現する。
```

> 実装では `playTrack.at` は未実装（即時実行）。`dance` は `style` / `moves` / `energy` を身体へ渡す。生成モデル用の `Cue.description` はまだ使っていない。

### 5.4 4小節プランの例

```json
{
  "bars": 4,
  "plan": [
    { "bar": 0, "layers": [
      { "move": "bounce", "amp": 0.6 },
      { "move": "sway", "amp": 0.3 }
    ]},
    { "bar": 2, "layers": [
      { "move": "armWave", "side": "R", "amp": 0.8 }
    ]},
    { "bar": 3, "accent": "spin" }
  ]
}
```

### 5.5 公演シーケンスの例

```
Dance（cute / 8小節）
 → stopMusic（1小節フェード）
 → Talk「今日はありがとう」
 → walkTo center
 → playTrack next（次の小節）
 → Dance（hiphop / 8小節）
```

---

## 6. 90% atom＋procedural / 10% 生成

### 6.1 なぜ分けるか

- atom＋proceduralは**即時・安定・安い**
- 生成モデルは**見栄えの上限が高いが、遅い・不安定・高い**
- 全部を生成にすると、展示で止まるリスクが高い
- 全部をatomにすると、動きの語彙が狭く飽きる

### 6.2 90%側

**proceduralベース（常時）**

- 呼吸、重心の揺れ、拍の上下動
- 腕・肩・頭の小さな追従
- ビートアクセント

**atom（0.5〜2秒）**

- bounce
- sway
- stepTouch
- armWave
- point
- spin
- headNod
- pose

**重要:** atomは「完成振付」ではなく「動きの部品」。並び・タイミング・強弱はLLMが毎小節組む。

**旧実装（2026-11-08 / 2026-11-12 に退役）**: `src/dance/dance.ts` の `sampleDance(clock, cue)` が base groove と atom を合成する純関数。Three.js 側は `DanceStage.tsx` が GLTFLoader の sanitize 名を吸収してボーンへ加算していた。

**現在（2026-11-12〜）**: 身体は Mixamo のモーションキャプチャクリップ主体。`src/dance/mixamo.ts` がクリップを読み込み、style（cute / cool / hype / chill）をクリップへマップし、BPM に `timeScale` を合わせる。`dance.ts` の型・検証・`mergeDanceCue` は MC ツール用に残している。

### 6.3 10%側

- サビ、ドロップ、オープニングなど限定のspecial
- **サビの2〜4秒前に生成開始**し、間に合えば差し込む
- 間に合わなければatomで代用
- 生成結果はキャッシュし、同じ曲では再利用可能

### 6.4 生成モデル候補

| モデル | 入力 | 注意 |
| --- | --- | --- |
| TM2D | テキスト＋音楽 | 「テキストでダンス制御」に一番近い。コード・ライセンス・GPU要件を要確認 |
| FlowerDance | 音楽 | 音楽同期は強い。テキスト条件はネイティブでない場合がある |
| Bailando / EDGE | 音楽 | 同上。スタイル制御は選択層で近似 |
| Wan-Dancer | 画像＋音楽 | 3Dではなく動画。別モードとして扱う |
| Motion Matching | 音楽＋特徴量 | 生成ではないがリアルタイム。モーキャプDBが必要 |

**注意:** FlowerDance / EDGE は music-to-dance であり、text condition を持たないことが多い。「テキストで制御」は、スタイル別候補の生成→選択、またはstyle-conditioned版で近似する。TM2Dが使えるならそれが本命。

### 6.5 評価軸

- ビート同期（拍に合っているか）
- スタイル一致（テキストの意図）
- 足滑り
- レイテンシ
- バリエーション（同じ動きの繰り返し）
- 観客の反応
- 失敗時のフォールバック品質

---

## 7. ショー状態機械

### 7.1 モード

| モード | 下半身 | 上半身 | 音楽 |
| --- | --- | --- | --- |
| Idle | 立つ | 小さな仕草 | なし/小 |
| Walk | 歩く | 手振り・会話 | あり/なし |
| Talk | 立つ | ジェスチャー | ダッキング |
| Dance | ダンス | ダンス | 再生中 |
| Transition | ブレンド | ブレンド | フェード中 |

### 7.2 遷移

**踊る → 止める**

- 1〜2拍でフェードアウト
- 身体は0.5秒でDanceからIdle/Walkへ
- 硬く止める場合は0.2〜0.3秒フリーズしてから戻す（演出）

**曲を変える**

- 次の小節頭でクロスフェード
- BPM・拍位相を更新
- BPM差が大きい場合は、一度Talk/Walkを挟む
- ダンスは新しい曲の頭で再同期

**歩く**

- ステージ上のマーク（center / left / right / front）へ移動
- ルート移動＋Walkingクリップ
- Danceの重みを0に
- 到着後、観客の方向へ向き直る

**喋る**

- 音楽をダッキング、または停止
- 観客／カメラの方向へ
- 発話中はGestureを上乗せ
- 次の小節でDanceに戻る

**中断**

- 来場者が話しかけたら会話を優先
- 音楽をダッキング
- 会話後、次の小節で公演に戻る

### 7.3 ステージ

- マークは最初は3〜4個で十分
- 歩行範囲はプラットフォーム内に制限
- 足滑りを避けるため、最初は短距離の歩行に限定

---

## 8. MCループ

### 8.1 目的

LLMが「今喋るべきか」「何を言うか」を自分で決める。定型文の再生ではない。

### 8.2 入力

```json
{
  "mode": "dance",
  "track": { "title": "Neon Drive", "bpm": 112, "bar": 16, "section": "build" },
  "crowd": { "people": 3, "smiles": 2, "motion": 0.7 },
  "lastLine": "みんな盛り上がってるかい？",
  "barsSinceSpoke": 8,
  "nextDropIn": 4,
  "canSpeak": true
}
```

### 8.3 出力

```json
{
  "speak": true,
  "text": "いいね、あと4小節で落とすよ。上げてこうぜ！",
  "duckMusic": true
}
```

`speak: false` も正しい判断。沈黙もLLMに選ばせる。

### 8.4 発話ウィンドウ

- 8小節ごと
- 曲の変わり目
- ドロップ前
- 歩行中
- 会話の終了後

1回2〜6秒。長話はしない。ドロップ中は基本黙る。正確なカウントダウン（3, 2, 1）だけTTSを小節に予約する。

### 8.5 観客・カメラ連動

既存のMediaPipe / 表情 / 人数 / 動きを使う。

- 人が少ない → 「今日はゆっくり始めようか」
- 笑っている → 「今の笑ったね、いいよ」
- 盛り上がりが低い → 「まだいけるだろ？」→ ドロップ
- 盛り上がりが高い → 「このまま行くよ」

### 8.6 音声経路

- 通常のMC: Gemini Liveのネイティブ音声
- 拍に正確に合わせたい台詞: TTSをキューに積む
- 発話中: 音楽を-8dB程度ダッキング
- `useGeminiLive` の `state` / `volume` を使い、DJ用のシステムプロンプトとツールだけ差し替える

### 8.7 注意

- スピーカーの音楽をマイクが拾うと、LLMが自分に反応する
- `echoCancellation` は必須
- 展示では指向性マイク、または発話時だけ音楽を下げる運用が安全

---

## 9. モデル差し替え戦略

### 9.1 境界

```
Director → Cue / ShowAction → Performance Engine → MotionSource → Retargeter → Character
```

- Directorはモデルを知らない
- UIはモデルを知らない
- MotionSourceだけを差し替える
- Retargeterはキャラクター差し替えのときにだけ触る

### 9.2 何を変えて、何を変えないか

| 変更 | 触る場所 | 触らない場所 |
| --- | --- | --- |
| 生成モデルを交換 | MotionSource + adapter | LLM、UI、Cue |
| キャラクターを交換 | Retargeter | モーション生成側 |
| 曲・BPM解析を交換 | MusicTransport | MotionSourceの外側 |
| LLMを交換（Gemini→local） | Directorの実装 | 身体、UI |
| Wan-Dancerを追加 | 別の映像モード | 3Dステージ |

### 9.3 capabilities

新しいモデルがテキスト条件を持たない場合、adapterが「スタイル選択」に変換する。Directorは `capabilities` を見て、無理な指示を出さない。

### 9.4 フォールバック

```
生成special → MotionMatching → atom＋procedural → idle
```

- 生成が遅い/失敗 → atom
- atomがない → procedural
- proceduralも失敗 → idle（止まらない）

### 9.5 正直なコスト

インターフェースを切っても、以下は残る。

- SMPL → VRM/ロボットのリターゲット
- モデルごとの入力形式の違い
- GPU、ライセンス、レイテンシ
- 生成結果がatomより良いとは限らない

ただし、これらをステージ本体から隔離できる。

---

## 10. 実装計画

### Phase 0: 3Dステージ（完了）

- `index.html`（`dance.html` は互換エイリアス）
- Three.js + Mixamo の人間キャラ（Michelle）
- クリップ再生、テキスト→クリップ、BPM、シンセ音
- Bloom、ライト、粒子、レスポンシブ
- `pnpm build` / `tsc` 通過

### Phase 1: ショー状態機械（実装済み）

- `ShowAction`（dance / stopMusic / playTrack / walkTo / talk / gesture）を `src/dance/show.ts` に定義
- 「止めて」「歩いて」「次の曲」「話して」を実装
- `DanceAudio` に2曲（NEON DRIVE / PULSE）、フェード停止、ダッキング、拍位相を追加
- 5シーケンスを通す: 踊る→止める→話す→歩く→次の曲で踊る

### Phase 2: MCループ（実装済み）

- 8小節ごとに `buildMcPrompt` で show state を送る
- Gemini LiveにDJ人格プロンプトを渡す
- 発話中は音楽をダッキング
- 声はGemini Liveのネイティブ音声。マイクは開かない（`capture:false`）のでハウリングしない
- カメラの人数・表情はまだ入力していない

### Phase 3: ダンス身体（実装済み / 2026-11-12 に Mixamo へ移行）

- Mixamo の Michelle＋モーションキャプチャのダンスクリップ（`src/dance/mixamo.ts`）
- style をクリップへマップ: hype=`Robot_Hip_Hop_Dance` / cool=`Breakdance_Uprock` / cute=`Jazz_Dancing` / chill=`House_Dancing`
- 歩行はルート移動＋ Mixamo の `Walking` クリップ
- BPMに合わせて `AnimationAction.timeScale` を変更（0.8〜1.25）。ダンスの拍位相は `DanceAudio.getPhase()` から取る
- 旧 `src/dance/dance.ts` の base groove＋atom はステージから退役（型・検証だけ残す）

### Phase 4: LLM Director（実装済み）

- Gemini Liveのツールから `dance` / `stop_music` / `play_track` / `walk` / `talk` / `gesture` を実行
- `dance` ツールで style / moves / energy / BPM を指定する
- MCの判断と発話を同じターンで行う
- 画面上にMCの発話と現在のモード・曲・BPM・style・energyを表示
- 検証・キュー・nextBarの厳密な量化はまだ簡易

### Phase 5: 10%生成special

- モデルを1つ選ぶ（TM2D / FlowerDance / EDGE）
- 1曲でオフライン生成
- Retargeterを通す
- サビ前に先読みして差し込む
- atomとA/B比較

### Phase 6: キャラクター

- Mixamo の Michelle を採用済み
- VRM猫耳人間 / 3D猫は候補から外す
- Retargeterを調整
- 表情・リップシンク

### 受け入れ条件

- 60fpsを維持
- 発話・判断のレイテンシが1小節以内
- 曲停止・変更で身体が止まらない
- 歩行で足滑りが目立たない
- MCが喋りすぎない
- 生成が失敗しても公演が続く

---

## 11. 現在の実装

| ファイル | 内容 |
| --- | --- |
| `index.html` | 3Dステージのエントリ（`/`）。`dance.html` は互換エイリアス |
| `src/dance/DanceStage.tsx` | Three.jsシーン、公演状態、歩行ルート、Mixamo の再生、UI |
| `src/dance/show.ts` | `ShowAction` / `ShowState`、2曲、ステージマーク |
| `src/dance/mc.ts` | DJ用システムプロンプト、Gemini Liveツール、MCプロンプト |
| `src/dance/audio.ts` | 2曲のWeb Audioシンセ、停止フェード、ダッキング、拍位相 |
| `src/dance/mixamo.ts` | Mixamo の読み込み、接地正規化、ルートモーション除去、BPM 追従 |
| `src/dance/dance.css` | ステージUI（MCパネル含む） |
| `src/hooks/useGeminiLive.ts` | カスタムプロンプト／ツール／ツール実行／`capture:false`／`prompt()` を追加 |
| `public/models/mixamo/` | Mixamo の Michelle＋ダンスクリップ（出典・ライセンスは README） |
| `vite.config.ts` | `index.html` と `dance.html` をビルド入力に持つ |

### 実装メモ

- **MCは出力専用**。`capture:false` でマイクを開かないため、スピーカーの音を拾わない。観客との双方向会話は、音楽の回り込み対策を設計してから足す。
- **MCの判断**。8小節ごとに `buildMcPrompt` を送り、モデルが発話するか黙るかを決める。「話して」ボタンは強制プロンプト。
- **Ducking**。`gemini.state === "speaking"` または `mode === "talk"` の間、音楽バスを0.28に下げる。
- **BPM同期**。Mixamo クリップの `timeScale = bpm / クリップ本来のBPM`（0.8〜1.25）。拍の頭でライトがパルスする。
- **style**。hype / cool / cute / chill を Mixamo クリップへマップする。`energy` と `moves` は今は見た目に反映しない（MC 休止中）。
- **歩行**。`center / left / right / front` のマークへルート移動。到着後はIdleまたはDanceへ戻る。
- **停止**。1小節フェード。身体はIdleへクロスフェード。
- **フォールバック**。Studioが落ちている／トークンが取れない場合は「MC OFFLINE」と表示し、ステージは動き続ける。

### 未接続・簡易なところ

- 本物の曲・ビート解析（今はシンセ2曲）
- 生成モデルと `MotionSource` 抽象化
- 観客・カメラ入力（人数、表情、動き）
- リップシンク、表情
- `nextBar` での厳密なキューイング（今は即時実行）
- `shortcut:` 歩行は直線移動＋到着後に向き直るだけ。段差・障害物・足滑り補正なし
- 実機マイク／スピーカーの回り込み試験
- 表情・ジェスチャー・リップシンク（Mixamo Michelle 本体は導入済み）

### 起動

```bash
pnpm dev
# http://localhost:5173
# http://localhost:5173/dance.html （互換エイリアス）
```

MCを使うには Studio（:3000）と `GEMINI_API_KEY` が必要。Studioが無くてもステージ操作は動く。

---

## 12. 未決事項

- キャラクター: Mixamo Michelle に決定。表情・視線の実装方法
- 最初に試す生成モデル: TM2D / FlowerDance / EDGE
- 音楽: シンセのまま / CC0楽曲 / 生成音楽
- 展示の音響: スピーカー＋マイクの回り込み対策
- 90/10の比率が本当に適切か（最初の実測で見直す）
- MCの判断周期を8小節から短くするか（観客入力とnextBarの実装時）
- 本物の曲をいつ入れるか（ライセンスとビート解析）

## 13. リスク

- 生成モーションがatomより見劣りする
- リターゲットで足滑り・不自然な関節が出る
- 生成モデルのレイテンシが展示に耐えない
- MCが喋りすぎる / 同じことを繰り返す
- 音楽とマイクの回り込みで誤反応する
- 曲のライセンスが未解決
- VRM / 生成モーションへ移す場合、リターゲット工数が増える

---

## 14. 一言で

**LLMは頭、MusicTransportは心臓、身体エンジンは筋肉。  
90%は即興の語彙で踊り、10%だけ生成モデルで特別な見せ場を作る。  
モデルは後から差し替えられるように、最初からソケットを切っておく。**
