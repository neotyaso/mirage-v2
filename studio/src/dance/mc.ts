import { Type } from "@google/genai";
import type { FunctionDeclaration } from "@google/genai";
import type { ShowState } from "./show";

export const DJ_SYSTEM_PROMPT =
  "あなたはMIRAGE、ステージに立つAI DJ。日本語で、短く、ライブ感のある一言だけ話す。" +
  "1回の発話は2〜6秒。長話・説明・自己紹介の連発はしない。" +
  "show state（モード、曲、BPM、小節、再生中か）を見て、盛り上がりに合わせて喋る。" +
  "曲が鳴っている間は、8小節ごとにMCのチャンス。まだ早い・盛り上がり中・ドロップ中なら黙る。" +
  "言うことがなければ、ツールを呼ばず、音声も出さずにそのターンを終える。" +
  "曲を止める、曲を変える、歩く、踊る、手を振るなどの舞台操作は必ずツールで実行する。" +
  "dance ツールでは style（cute / cool / hype / chill）と moves（bounce / sway / stepTouch / armWave / point / spin / pose / headNod）で振付の方向を指定する。" +
  "moves は1〜4個。8小節ごとに、曲の雰囲気に合わせて新しい組み合わせを選んでよい。" +
  "「みんな盛り上がってるかい？」のような定番は使ってよいが、毎回同じ言い回しにしない。" +
  "観客を煽る、曲を紹介する、動きを説明する、次の展開を予告する、のどれかを短く。" +
  "日本語以外では話さない。";

export const DJ_TOOLS: FunctionDeclaration[] = [
  {
    name: "dance",
    description: "踊りを開始/継続する。style と moves で振付の方向を指定する。",
    parameters: {
      type: Type.OBJECT,
      properties: {
        style: { type: Type.STRING, description: "cute / cool / hype / chill" },
        energy: { type: Type.NUMBER, description: "0.0〜1.0。大きいほど激しく" },
        bpm: { type: Type.NUMBER, description: "任意。曲のBPMを変える" },
        moves: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "1小節ごとの動き。bounce / sway / stepTouch / armWave / point / spin / pose / headNod から1〜4個。",
        },
      },
    },
  },
  {
    name: "stop_music",
    description: "音楽をフェードアウトして止める。MCや移動の前に使う。",
    parameters: {
      type: Type.OBJECT,
      properties: {
        fadeBars: { type: Type.NUMBER, description: "何小節かけて止めるか。既定1" },
      },
    },
  },
  {
    name: "play_track",
    description: "次の曲を頭から再生する。",
    parameters: {
      type: Type.OBJECT,
      properties: {
        trackId: { type: Type.STRING, description: "neon" },
      },
      required: ["trackId"],
    },
  },
  {
    name: "walk",
    description: "ステージ上のマークへ歩いて移動する。到着後はIdleに戻る。",
    parameters: {
      type: Type.OBJECT,
      properties: {
        mark: { type: Type.STRING, description: "center / left / right / front" },
      },
      required: ["mark"],
    },
  },
  {
    name: "talk",
    description: "MCモードに入る。音楽を小さくして、観客に向き直る。",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "gesture",
    description: "手を振る、頷く、指差す、ガッツポーズなどの短いジェスチャー。",
    parameters: {
      type: Type.OBJECT,
      properties: {
        intent: { type: Type.STRING, description: "wave / nod / point / celebrate" },
      },
      required: ["intent"],
    },
  },
];

export function buildMcPrompt(state: ShowState, force = false): string {
  const payload = {
    mode: state.mode,
    track: state.trackName,
    trackId: state.trackId,
    bpm: state.bpm,
    playing: state.playing,
    bar: state.bar,
    beat: state.beat,
    style: state.style,
    energy: state.energy,
  };
  const ask = force
    ? "今すぐ、必ず2〜6秒の日本語で一言話して。話したら dance ツールで踊りに戻って。"
    : "今はMCの番か判断して。話すなら2〜6秒の日本語で一言。話さないなら何も出力せずに終了して。";
  return (
    `show state: ${JSON.stringify(payload)}\n` +
    ask +
    "必要なら舞台操作ツールも同じターンで呼んでよい。"
  );
}
