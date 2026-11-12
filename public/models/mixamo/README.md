# Mixamo assets

MIRAGE のダンスステージで使う Mixamo 素材。

## 出典

- `Michelle.glb` — Three.js examples `examples/models/gltf/Michelle.glb`（Mixamo のキャラクター）。
  - https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Michelle.glb
- `Idle.glb`, `Walking.glb`, `Robot_Hip_Hop_Dance.glb`, `Breakdance_Uprock.glb`, `Jazz_Dancing.glb`, `House_Dancing.glb` — Mixamo のアニメーションを GLB に変換したもの。
  - https://github.com/MisterYI/deevid-mixamo-assets

Mixamo の素材は Adobe の Mixamo / Adobe Terms の範囲で無料利用できる。再配布物として単体販売しない。詳細は https://www.mixamo.com と https://www.adobe.com/legal/terms.html を参照。

## 差し替え

`src/dance/mixamo.ts` の `MIXAMO_CLIPS` と `STYLE_CLIP` を更新する。クリップは Mixamo 標準の 65 ボーン（`mixamorigHips` など）であれば `Michelle.glb` にそのまま載る。
