import { useRef, useState } from 'react';
import { toFriendlyMessage } from '../ui';

/**
 * ブラウザ標準のWeb Speech API(SpeechRecognition)の最小限の型定義。
 * lib.domには含まれておらず、ベンダープレフィックス(webkitSpeechRecognition)も必要なため
 * ここで宣言する。
 */
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string };
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

/**
 * 話して入力(GAS版index.htmlのstartVoiceInput/resetMicBtnと同じ挙動)。
 * `ja-JP`・`continuous: true`(短い間でも止まらない)で、確定した(isFinalな)発話区間だけを
 * `onTranscript`へ渡す。呼び出し側はテキストエリアへの追記方法(改行区切りで末尾に足す等)を
 * 自由に決められる。同じ認識中に再度呼ぶと停止する、というトグル動作もGAS版と同じ。
 */
export function useVoiceInput(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const toggle = () => {
    setError(null);

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setError('この機種では、話して入力が使えません。文字で書いてください');
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'ja-JP';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      let newTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal && result[0]) newTranscript += result[0].transcript;
      }
      if (newTranscript) onTranscript(newTranscript);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognition.onerror = (event) => {
      // 画面には次にすることだけを書き、原因(event.error)はconsoleへ出す
      // (提案書doc/16_UIUX改善提案_2026-09-03.html「英語の技術メッセージを出さない」)。
      if (event.error === 'not-allowed') {
        setError('マイクが使えません。スマホの設定でマイクを許可してください');
      } else if (event.error === 'network') {
        setError('電波が弱いようです。つながる場所で、もう一度押してください');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(
          toFriendlyMessage(event.error, '音声入力', 'うまく聞き取れませんでした。もう一度押してください'),
        );
      }
      // UIのリセットはonendで行う(GAS版と同じ、onerror後に必ずonendが発火する前提)。
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  return { listening, error, toggle };
}
