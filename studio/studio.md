# Mirage Studio — 開発方針と学習計画

> **2026-11-08 更新**: Mirage 本線は AI DJ / 3Dパフォーマー（D-023）。Studio の現在の役割は、Live 用の短命トークン発行と API 中継（検索・天気・vision）。下記の Dashboard / Sessions / 来場者管理はレセプション時代の計画で、DJ の管理画面を作るときに読み替える。

## 目的

展示PC上で自律動作する AI キャラクター「Mirage」の状態を、ブラウザから観測・管理する Web アプリ。
**最重要方針: 完成することと、自分がコードの意味を説明でき必要な部分を書き換えられる状態になることを両立する。**
AI は実装パートナー。丸投げも、全部自分で書くのもしない。

## 開発・学習のサイクル

```
AIに小さく作らせる → 動かす → コードを見る → 分からないところを聞く → 7〜8割理解 → 次へ
```

### 守るべき原則

1. **AIには積極的に実装させる**。ただし一度に大量の実装をさせず、小さな機能単位で進める
2. **AIが実装したコードは自分で読んで**処理の流れを確認する
3. **分からないコード・用語・ライブラリ・設計が出たら、その都度質問・調査する**
4. **すべてを完全に理解することを目指さず、まず7〜8割程度理解して先に進む**
5. **ただし、分からないものをそのまま放置して積み上げない**
6. **Mirage Studioの開発そのものを、React・TypeScript・Next.js・API・DB・WebSocket・Docker・AWSなどを実際に学ぶ場として利用する**
7. **最終的には、AIが生成したコードを自分で説明でき、必要な部分を自分でも書き換えられる状態を目指す**

---

## AIへの依頼の粒度（最重要）

### ❌ 悪い依頼
```
Mirage Studioを完成させて。
```

### ⭕ 良い依頼
```
Mirage StudioのDashboardを作りたい。
今回は「Mirageの現在状態を表示する部分」だけ実装してください。
Mirage本体との通信はまだ行わず、まずはダミーデータを使ってください。
変更したファイルと、それぞれ何を変更したのかを説明してください。
実装後に私がコードを確認したいので、今回の変更範囲を広げないでください。
```

この粒度なら「今回AIが何を変更したのか」を追える。

---

## 学習対象と進め方

HTML・CSSは理解している前提とし、基礎説明は省く。
Studioを小さく動かしながら、React・TypeScript・Next.js・Gitを一緒に学ぶ。各技術を別々に座学で終えてから実装する進め方にはしない。

- React: 状態（useState）、イベント、コンポーネント、props、必要になった段階でuseEffect
- TypeScript: 型推論、リテラル型・ユニオン型、propsやAPIデータの型。実際に型エラーを見て役割を理解する
- Next.js: page.tsx、App Router、Client / Server Components、API。触った機能から理解する
- Git: 実際の変更を材料に、差分確認・ステージング・コミット・履歴・ブランチを学ぶ

学習パス: 画面を作る → useStateとボタン → 状態の型を限定する → コンポーネントとprops → APIと必要なuseEffect → WebSocket → Mirageの状態を取得

### Gitの学び方

- まず `git status` で変更されたファイルを確認し、`git diff` で変更内容を読む。未追跡ファイルの内容は通常の `git diff` には出ない
- 小さな変更が動いた区切りで、対象ファイルだけを `git add` し、`git diff --staged` で記録する内容を確認する
- `git commit` で変更を履歴に残し、`git log` で振り返る。コミットとリモートへ送る `git push` の違いも実際の操作で学ぶ
- ブランチ・マージ・コンフリクト解消は必要になった段階で扱う
- 自分で実行できる操作は自分で行う。変更を伴うコマンドは、何が変わるかを実行前に短く説明する
- AIは明示的な依頼なしにコミット・pushを実行しない。秘密情報はステージング・コミットしない

---

## 何を作るか（MVP の完成ライン）

> 「Mirage が今何をしているのかを、ブラウザから見られる」

- Login（管理者1ロール。まずは簡易認証、Auth.js 等への置き換えは後）
- Dashboard: Mirage の状態 / 検知中の来場者 / アクティブ・待ち / 言語 / 現在の Interaction 状態
- Session List / Session Detail（会話ログ・Interaction Timeline）
- Settings: 言語・閾値・表示（まずは読み取り中心、変更の反映は次段）

後回し（この順で育てる）: 設定変更の反映 → Analytics → 遠隔操作 → 複数 Mirage → PostgreSQL → AWS

---

## 構成

- Mirage 本体 = このリポジトリ（Vite + React、展示PC）
- Mirage Studio = 別の Next.js アプリ。このリポジトリの `studio/` に置く（別リポジトリに split するかは後で判断）
- Mirage → Studio: WebSocket（状態・イベント）＋ REST（セッション・設定）。デバイストークンで認証
- Studio → Mirage: 将来的に設定変更・操作命令（MVP では受信のみ）
- Studio が落ちても Mirage は自律動作を継続する（最優先）

---

## 技術スタック（仮。実装の都度、その都度説明して決める）

- Next.js（App Router）/ React / TypeScript / Tailwind
- DB: SQLite + ORM（Drizzle or Prisma）で開始。複数端末・リモート運用時に PostgreSQL へ
- 認証: 管理者1ロール。環境変数＋署名付き HttpOnly Cookie。Auth.js は後
- Mirage→Studio: 管理セッションとは別のデバイストークン

<!-- ponytail: 簡易認証。複数管理者・権限管理が要る段階で Auth.js に置き換え -->

---

## 進め方（ステップ）

### Phase 1: 基盤とDashboardの土台
1. `studio/` にNext.jsの最小プロジェクトを作り、pnpmで起動する
2. Dashboard画面のUIを作る（ダミーデータで表示）
3. useStateで状態を変更してみる（ONLINE/OFFLINE切り替え等）

### Phase 2: 実データとリアルタイム通信
4. Studio の API から Mirage のセッション/設定を取得する（REST）
5. WebSocket で Mirage の状態・イベントをリアルタイム更新する

### Phase 3: セッション管理と認証
6. セッションの保存とSession List / Detail、認証を実装しDashboardとして統合する。未認証の管理画面をインターネットに公開しない
7. 複数人（検知中/アクティブ/待ち）と JA/EN の表示を Dashboard に足す

### Phase 4 以降
8. 以降: 設定変更の反映 → Analytics → 遠隔操作 → 複数台（PostgreSQL）

各ステップの小さな変更をGit学習の材料にする。

---