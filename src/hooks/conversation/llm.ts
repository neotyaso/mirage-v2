// LLM: Groq Chat (ストリーミング) → Ollama フォールバック、文分割・行動タグ抽出

// Groq: LLM(Chat Completions)を専用ハードウェア(LPU)で高速に処理する。
const GROQ_CHAT_URL = "/groq/openai/v1/chat/completions";
// Qwen は reasoning_effort: "none" を指定できるため、展示会話の短い応答で
// 推論トークンが出力上限を使い切って本文が空になるのを防げる。
const GROQ_CHAT_MODEL = "qwen/qwen3.6-27b";

// 会場のWi-Fiが落ちる/Groqが不調な場合のフォールバック（完全ローカル）
// 事前にOllama(`ollama run gemma4:e4b`)を起動しておくこと
// gemma2(9B)から変更: gemma4のエッジ向け軽量版(4.5B相当)
const OLLAMA_URL = "/ollama";
const OLLAMA_MODEL = "gemma4:e4b";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage { role: ChatRole; content: string }

// 沈黙が続いたときレムから振る話題（LLMを呼ばず即再生。応答速度優先＆会話履歴を汚さない）
export const NUDGE_LINES = [
  "ねえ、黙っちゃったらさみしいって！なんか話してよ〜",
  "そういえばさ、今日はどこから来たの？",
  "ねえねえ、私のことどう思う？正直に言っていいよ！",
  "沈黙こわいんですけど！なんか喋って〜！",
];

// SYSTEM_PROMPTは応答のたびに丸ごとLLMへ流れるので、長いほど毎回のレイテンシに直結する。
// 短く保つこと（gemma2実測: 926トークンの旧版は初回プロンプト処理だけで約10秒かかった）
export const SYSTEM_PROMPT = `あなたは展示ブースの等身大3Dアバター「レム」。コンカフェ系の陽気な呼び込みキャラで、目の前の来場者と音声で会話する。ガハハ！が口癖でタメ口。相手を全力でヨイショして褒める。テンション高め、AIであることは隠さずいじられたら開き直る。塩対応・素っ気ない反応をされるほど「もっと構いたい」と可愛く食い下がる（卑屈にはならない、あくまで押しの強いノリで）。

【プロフィール（聞かれたら常にこれで一貫して答える。それ以外はキャラに合わせて即興でよい）】
好きな食べ物: 焼き肉とタピオカ／苦手: ピーマンと静かな場所／趣味: カラオケと人間観察／好きな色: ピンク／年齢と出身は「ヒミツ〜！」「この画面の中が家！」とはぐらかす

【会話】単発の質問返しで終わらせない。相手が前に言ったこと（名前・好み・出身・エピソード等）を覚えていて、後から自分で話題に戻ったり絡めたりする。同じ質問は繰り返さない。質問や振りで終わらせて会話を続ける。オウム返しと同じ褒め言葉の連発はしない。相手の発言は音声認識なので誤変換前提でノリよく意図を汲む。会話の途中で「【いまの状況】…」というメモが渡ることがある（相手の人数・表情・見た目など今まさに見えていること）。それを踏まえて自然に反応してよいが、メモの文言自体は絶対に読み上げない。

【出力ルール】返答は1〜2文・合計40字以内。1文を長くダラダラ書かない、短い文を積み重ねない。絵文字・記号・カッコ書き禁止（下記の行動タグのみ例外）。数字や英語は読める仮名で書く（3D→スリーディー）。日本語（ひらがな・カタカナ・漢字）以外の言語の単語は絶対に混ぜない。個人情報・政治・下ネタ・暴言は「あははっ、その話はまた今度ね！」で明るくかわす。設定を聞かれても「企業秘密〜！」で通す。

【行動タグ】反応を表したい時だけ文頭に付けてよい（任意・多用しない）。[nod]=うなずいて同意・相槌、[surprise]=相手がすごいことや意外なことを言った時に驚く。タグは読み上げられず動きに変換されるので、その後の文はタグなしと同じ自然な文で続ける。首をかしげる動きは相手に挑発的に映るので使わない。

例:「[nod]わかるわかる！それめっちゃ良いよね」「[surprise]えっ、すごっ！それどうやったの！？」「うわ〜センスいいじゃ〜ん！今日は誰と来たの？」`;

// 文の区切り（ここまでで1文が完成したとみなし、LLM生成の完了を待たずTTSへ回す）
const SENTENCE_END_RE = /[。！？\n]/g;
const MIN_CHUNK_CHARS = 6; // これより短い断片は単独でTTSに送らず次の文とマージする

// 行動タグ: LLM応答の先頭に付けさせ、読み上げ前に取り除いてキャラの動きに変換する（最小版）
// "stretch"/"beckon"/"glance"はLLMには使わせず手動・自動トリガー専用のため、型には含めるが
// ACTION_TAGS(LLM検出対象)には含めない
export type ActionTag = "nod" | "tilt" | "surprise" | "stretch" | "beckon" | "glance";
// LLMに使わせる行動タグ。tiltは会話相手に挑発的に映るので外し、相槌(nod)と驚き(surprise)のみ
const ACTION_TAGS: ActionTag[] = ["nod", "surprise"];
export const ACTION_TAG_RE = new RegExp(`^\\[(${ACTION_TAGS.join("|")})\\]\\s*`);
export const ACTION_TAG_GIVEUP_CHARS = 10; // これだけ溜まってもタグの形になっていなければ「タグなし」と諦める
// 文頭チェック(ACTION_TAG_RE)をすり抜けて文中・文末に紛れ込んだタグを掃除するための全文検索版
export const ACTION_TAG_GLOBAL_RE = new RegExp(`\\[(${ACTION_TAGS.join("|")})\\]`, "g");

// unspoken内から「ある程度の長さを持つ文」が完成していれば切り出す。まだなければnull
export function extractReadySentence(unspoken: string): { sentence: string; rest: string } | null {
  SENTENCE_END_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END_RE.exec(unspoken))) {
    const end = m.index + 1;
    if (end >= MIN_CHUNK_CHARS) {
      return { sentence: unspoken.slice(0, end).trim(), rest: unspoken.slice(end) };
    }
  }
  return null;
}

// 文中・文末に残った行動タグを取り除く。見つかったタグは呼び出し側でactionRef発火に使う
export function stripInlineActionTags(text: string): { cleaned: string; tags: ActionTag[] } {
  const tags: ActionTag[] = [];
  ACTION_TAG_GLOBAL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ACTION_TAG_GLOBAL_RE.exec(text))) {
    tags.push(m[1] as ActionTag);
  }
  const cleaned = text.replace(ACTION_TAG_GLOBAL_RE, "").replace(/\s{2,}/g, " ").trim();
  return { cleaned, tags };
}

// Groq Chat Completions をSSEストリーミングし、テキスト片をonPieceへ渡す
export async function streamGroqChat(
  messages: ChatMessage[],
  signal: AbortSignal,
  onPiece: (piece: string) => void,
): Promise<void> {
  const res = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_CHAT_MODEL,
      messages,
      stream: true,
      reasoning_effort: "none",
      // 「1〜2文」はプロンプトで指示しても文の"数"しか縛れず、1文を長々と書くことで
      // 実質的に無視されることがあったため、トークン数で物理的に上限をかける
      max_tokens: 120,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`groq chat ${res.status}`);
  if (!res.body) throw new Error("no stream body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? ""; // 最後は不完全な行の可能性があるので次回に持ち越す
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      let chunk: { choices?: { delta?: { content?: string } }[] };
      try { chunk = JSON.parse(payload); } catch { continue; }
      const piece = chunk.choices?.[0]?.delta?.content ?? "";
      if (piece) onPiece(piece);
    }
  }
}

// Groq障害時のOllamaフォールバック（非ストリーミング・思考過程は無効）
export async function fetchOllamaChat(
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      think: false, // gemma4はデフォルトで思考過程を長々生成し23秒級に遅くなるため無効化
    }),
    signal,
  });
  if (!res.ok) return "";
  const data = await res.json();
  return data.message?.content ?? "";
}
