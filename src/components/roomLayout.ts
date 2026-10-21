// 展示スペースの家具配置。キオスク（自機）を原点にしたメートル指定。
//   lat: 左右。+が奥から見て右、-が左
//   d  : キオスクからの奥行き
//   w / dep / h: 幅 / 奥行き / 高さ
// 実寸が分かったらこの配列の数値を書き換えるだけで反映される。
export interface Furniture {
  kind: "desk" | "chair";
  lat: number;
  d: number;
  w: number;
  dep: number;
  h: number;
}

export const ROOM: Furniture[] = [
  { kind: "desk", lat: -1.7, d: 2.2, w: 1.4, dep: 0.7, h: 0.72 },
  { kind: "chair", lat: -1.5, d: 2.9, w: 0.5, dep: 0.5, h: 0.45 },
  { kind: "desk", lat: 1.9, d: 2.6, w: 1.2, dep: 0.7, h: 0.72 },
  { kind: "chair", lat: 1.7, d: 3.3, w: 0.5, dep: 0.5, h: 0.45 },
  { kind: "chair", lat: -0.9, d: 4.2, w: 0.5, dep: 0.5, h: 0.45 },
  { kind: "desk", lat: 0.2, d: 5.0, w: 1.6, dep: 0.8, h: 0.72 },
];
