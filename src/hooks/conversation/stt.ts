// ローカルSTTフォールバック: Web Speech API（ブラウザ内蔵）
// Gemini接続失敗時などに使う。マイク権限が必要。

// TSのDOMライブラリに定義が無いので最小限だけ自前で宣言する
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  length: number;
}
interface SpeechRecognitionResultListLike {
  0: SpeechRecognitionResultLike;
  length: number;
}
interface SpeechRecognitionEventLike {
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

// Safari等の vendor prefix も見る
function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isLocalSttSupported(): boolean {
  return getRecognitionCtor() !== null;
}

/**
 * マイクから1発聞き取り、確定したテキストを返す。
 * サポート外 / ユーザーキャンセル / 無音なら null。
 */
export function transcribeOnce(timeoutMs = 8000): Promise<string | null> {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return Promise.resolve(null);

  return new Promise((resolve) => {
    const rec = new Ctor();
    let done = false;
    const finish = (text: string | null) => {
      if (done) return;
      done = true;
      try { rec.stop(); } catch { /* already stopped */ }
      resolve(text);
    };

    rec.lang = "ja-JP";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;

    rec.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript?.trim() ?? "";
      finish(text || null);
    };
    rec.onerror = () => finish(null);
    rec.onend = () => finish(null);

    setTimeout(() => finish(null), timeoutMs);
    rec.start();
  });
}
