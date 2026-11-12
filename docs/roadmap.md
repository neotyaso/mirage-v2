# ロードマップ（正本） — AI DJ / 3Dパフォーマー

> 最終更新: 2026-11-08
> 本線: AI DJ / 3Dパフォーマー（D-023）。要件は [requirements.md](requirements.md)、決定は [decisions.md](decisions.md)、設計は [ai-dj-architecture.md](ai-dj-architecture.md)。
> レセプション時代の P 計画は [legacy/reception-roadmap.md](legacy/reception-roadmap.md) にアーカイブした。

## 状態凡例

| 記号 | 意味 |
| --- | --- |
| 完了 | 実装・確認済み |
| 進行中 | 着手中 |
| 未着手 | 設計のみ |
| 任意 | 今回の完了条件には含めない |
| 破棄 | 方針として中止 |

## 今回のスコープ

1ステージ・1体の 3D キャラクター。Gemini Live の Director が公演状態を判断し、`ShowAction` でダンス・停止・曲変更・歩行・トーク・ジェスチャーを実行する。身体はクリップ＋プロシージャルを主とし、生成モーションは特別枠に限定する。MC は日本語・出力専用。API キーはブラウザに置かず、Studio の短命トークンを使う。

## 一覧

| ID | 名前 | 状態 | 依存 | 完了条件 |
| --- | --- | --- | --- | --- |
| DJ-0 | 本線切替・レセプション退役・ドキュメント再編 | 完了 | — | `/` が DJ。旧要件を `docs/legacy/` に保管。受付 UI を削除 |
| DJ-1 | ショー状態機械（ShowAction / ShowState） | 完了 | — | dance / stop / play / walk / talk / gesture が動く |
| DJ-2 | MusicTransport（1曲・BPM・停止・ダッキング・拍位相） | 完了 | — | 曲停止・変更で身体が止まらない |
| DJ-3 | 身体（Mixamo ダンス＋歩行） | 完了 | DJ-1, DJ-2 | Mixamo の人間キャラ＋モーションキャプチャのダンスを BPM に合わせて再生。マークへ歩く |
| DJ-4 | Gemini Live MC / Director | 休止中 | DJ-1, DJ-2, DJ-3 | コードは残るが現在は接続しない。ダンスのみで公演する |
| DJ-5 | ステージ UI（MC パネル・状態・操作・ミュート） | 完了 | DJ-1〜4 | デスクトップ／モバイルで操作できる |
| DJ-6 | MotionSource 抽象化＋生成 special | 未着手 | DJ-3 | クリップ／プロシージャル／生成を差し替え可能。失敗時は atom に落ちる |
| DJ-7 | 観客入力（人数・表情・動き） | 未着手 | DJ-4 | Director が観客入力を使う。落ちても公演は続く |
| DJ-8 | 音楽・キュー・リップシンク | 進行中 | DJ-2, DJ-4 | 無料楽曲1曲＋手動ビートグリッド＋`nextBar` 量子化＋セクション切替は導入済み。任意曲の自動ビート解析、オンセット連動のアクセント、口パクが残り |
| DJ-9 | 品質・テスト・計測 | 進行中 | 各機能 | 純関数テスト、`pnpm test`、CI、30分稼働、latency 計測 |
| DJ-10 | キャラクター / Retargeter | 進行中 | DJ-3, DJ-6 | Mixamo Michelle＋ダンス導入済み。表情・視線・リップシンクが残り |

## 実装済み（2026-11-12）

- ステージの身体を **Mixamo の Michelle＋モーションキャプチャのダンス**に置き換え。`RobotExpressive.glb` と手続きダンス層はステージから外した。
- `src/dance/mixamo.ts` に Mixamo の読み込み・足の接地正規化・横方向ルートモーション除去・BPM 追従の `timeScale` を実装。
- ダンスクリップは hype=`Robot_Hip_Hop_Dance` / cool=`Twist_Dance` / cute=`Macarena_Dance` / chill=`House_Dancing`。
- 黒ステージ用のフロント光、人間の肌・布がブルームで飛ばないマテリアル調整、カメラ距離の調整。
- アセットの出典とライセンスを `public/models/mixamo/README.md` に記録。`scripts/test-mixamo.mjs` で GLB を検査。
- 音楽を Pixabay の無料楽曲「Dance Electro 120 bpm - Full」に差し替え。出典は `public/audio/README.md`、`scripts/test-audio.mjs` で音源を検査。
- 曲の **先頭ダウンビート 0.987s / 120 BPM / 60小節** を `TRACKS.neon` に記録し、`sectionAtBar` で intro / drop / break / build / outro を引く。`DanceStage` は小節頭でセクションのクリップへ切り替え、`playTrack` / `stopMusic` / `dance` を次の小節頭に量子化する。`scripts/test-sections.mjs` を追加。

## 実装済み（2026-11-08）

- `/` を AI DJ ステージに切り替え。`dance.html` は互換エイリアス。
- `ShowAction` と `ShowState`、2曲（NEON DRIVE 112 BPM / PULSE 128 BPM）。
- 停止フェード、発話ダッキング、拍位相、BPM の `timeScale` 補正。
- `center / left / right / front` への歩行と到着後の Idle / Dance 復帰。
- ダンス核 `src/dance/dance.ts`。拍同期の base groove＋小節ごとの atom、4 style（cute / cool / hype / chill）、8 moves。LLM の `dance` ツールから style / moves / energy を指定。
- ダンス核の純関数テスト `scripts/test-dance.mjs` を追加し、`pnpm test` で実行。
- Gemini Live の DJ 人格、出力専用セッション、8小節ごとの MC チャンス、6ツール。
- MC パネル、モード／曲／BPM／小節、クイック操作、MC・音楽ミュート、モバイル対応。
- Studio の Live 短命トークン。Studio 停止時は MC OFFLINE でステージ続行。
- レセプションの会話 UI・2D キャラ・会話フローを削除。カメラ／表情／トラッキング／Studio 基盤は再利用資産として保持。

## 着手順

```
[今]  DJ-8 残り（オンセット連動のアクセント＋任意曲のビート解析）
        └ 首・腕・ライト・カメラをキック／スネアに反応させる
        └ 曲を差し替える段階で自動解析を検討
[次]  DJ-9 残り（公演状態機械・BPM・キューの純関数テスト、CI）
        └ ダンス核は test-dance.mjs で固定済み
[次]  DJ-7 観客入力
        └ 人数・表情を Director に渡し、MC と energy を変える
[次]  DJ-6 MotionSource＋生成 special
        └ 90/10 の10%をソケット化。失敗時は atom
[次]  DJ-10 表情・リップシンク
        └ Mixamo Michelle 導入済み。表情・視線・Retargeter
[並行] DJ-9 計測・CI
[終]  通し品質（30分・曲停止/変更・MC の喋りすぎ・実機音響）
```

### なぜこの順か

- **テストを先に**: 状態機械と BPM 同期はこれから触る。純関数に切り出してから観客入力を足す。
- **オンセットを次に**: 小節頭のセクション切替だけでも「曲に合わせて踊っている」見え方になる。次はキック／スネアのアクセントで曲の細かいノリを拾う。
- **観客入力を次に**: 「LLMが考えてリアルタイムで踊る」の入力側。人数・表情が入ると、8小節固定の MC から判断らしくなる。
- **生成 special は後**: 90% の土台が安定してから。先に入れると、遅延・失敗で公演が止まる。
- **キャラクターは動きの土台が固まってから**: Mixamo Michelle で人間の身体と接地は確保済み。表情・リップシンクは音とキューの後。

## 直近のタスク

1. `ShowState` / `ShowAction` / BPM 同期 / キュー計算を純関数に切り出し、`scripts/` の自己テストを追加する。
2. キック／スネア／オンセットに合わせた首・腕・ライト・カメラのアクセントを足す。まずは既存の `onBeat` を使い、`AnalyserNode` は後から。
3. MC の判断周期を 8小節から 4小節へ短くし、発話回数と沈黙回数をログに残す。
4. `useFaceDetection` の人数・表情を Director のプロンプトへ渡す。カメラなしでも動くようにする。
5. 任意曲を入れる段階で、自動ビート解析または手動ビートグリッドの手順を整える。ライセンスを記録する。
6. `MotionSource` を切る。まず `ClipMotionSource` と `ProceduralMotionSource` の2つ。
7. 生成モデルを1つ選び、1曲のサビだけオフライン生成して A/B する。

## リスク

| リスク | 影響 | 対策 |
| --- | --- | --- |
| MC が喋りすぎる / 同じ言い回しを繰り返す | 公演が安っぽくなる | 発話回数・沈黙回数を計測。プロンプトと判断周期を調整 |
| nextBar 前の判断遅れ | 曲と身体がずれる | 前の cue を続ける。即時フォールバックを持つ |
| 生成モデルの遅延・失敗 | サビで止まる | 2〜4秒先読み。間に合わなければ atom |
| 歩行の足滑り | 没入感が落ちる | まず直線＋到着向き直し。必要なら IK |
| 音楽とマイクの回り込み | MC が誤反応する | まず出力専用。入力は実機試験後 |
| 曲のライセンス | 公開できない | CC0 / 許諾済みのみ。出典を記録 |
| Studio / Gemini 停止 | MC が止まる | MC OFFLINE。ステージ操作は継続 |
| ブラウザの API キー露出 | 悪用 | Studio の短命トークン（D-018） |

## 破棄・アーカイブ

- レセプション本線、受付の会話 UI、2D キャラクター、ビジター会話フロー: 2026-11-08 に退役（D-023）。
- 旧要件・旧ロードマップ: `docs/legacy/`。
- レセプション時代の P 番号は再利用しない。現在の完了判定は `DJ-*` を使う。
