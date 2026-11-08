# アバター

既定は **三毛猫のSVG**（`src/components/CatAvatar.tsx`）。画像を置かなくてもそのまま動きます。

## 画像に差し替える（任意）

このフォルダに `character.png`（透過PNG）を置き、`avatar.json` を作ります。

```json
{ "file": "/avatar/character.png" }
```

`avatar.json` が無い、または `file` が無いときは三毛猫のままです。
画像モードでは呼吸・浮遊・揺れ・視差・発話時の上下・発光が効きます。

さらに目と口の位置（画像に対する %）を書くと、まばたきと口パクも重なります。
`avatar.example.json` をコピーして数値を調整してください。

```json
{
  "file": "/avatar/character.png",
  "eyes":  { "x": 50, "y": 24, "gap": 12, "rx": 4, "ry": 3, "color": "#f2d9c9" },
  "mouth": { "x": 50, "y": 33, "rx": 5, "ry": 2, "color": "#8c4a4a" }
}
```

- `eyes`: 左右の中心は `x ± gap/2`。`color` は肌に近い色（まぶたとして重ねる）
- `mouth`: `color` は口内の色。`box-shadow` で発光させている

## 今入っている画像

`輝くホログラムAIアバター.png` と `character.png` は、猫に切り替える前の素材です（未使用）。
使うときは `avatar.json` で `character.png` を指定してください。
