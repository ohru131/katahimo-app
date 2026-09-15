import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiAiPort, NoopReportAiPort, parseImageDataUrl } from './geminiAiPort';

/**
 * 領収書画像のデータURLの解釈を固定する。
 *
 * GAS版は MIMEタイプを常に `image/jpeg` と申告して送っていた。スマートフォンのカメラ以外
 * (PNGのスクリーンショット、HEIC)から上げた領収書は申告と中身が食い違い、モデルが復号に
 * 失敗すると読み取り結果が黙って空になる。宣言されたMIMEタイプを渡すようにした一方で、
 * 読み取れない入力はGAS版と同じに倒す(既に通っていた入力を落とさない)。
 *
 * ネットワークには触れず、切り出しの関数だけを見る。
 */
describe('parseImageDataUrl', () => {
  it('宣言されたMIMEタイプと本体を取り出す', () => {
    expect(parseImageDataUrl('data:image/png;base64,AAAA')).toEqual({
      mimeType: 'image/png',
      data: 'AAAA',
    });
  });

  it('JPEG以外のサブタイプもそのまま通す(webp・heic)', () => {
    expect(parseImageDataUrl('data:image/webp;base64,BBBB')?.mimeType).toBe('image/webp');
    expect(parseImageDataUrl('data:image/heic;base64,CCCC')?.mimeType).toBe('image/heic');
  });

  it('大文字表記のMIMEタイプは小文字に揃える', () => {
    expect(parseImageDataUrl('DATA:IMAGE/PNG;BASE64,DDDD')).toEqual({
      mimeType: 'image/png',
      data: 'DDDD',
    });
  });

  it('`;base64` が無いデータURLは弾く(inline_data はbase64しか受けない)', () => {
    expect(parseImageDataUrl('data:image/gif,EEEE')).toBeNull();
    expect(parseImageDataUrl('data:image/gif;charset=utf-8,EEEE')).toBeNull();
  });

  it('`;base64` が他のパラメータと並んでいても拾う', () => {
    expect(parseImageDataUrl('data:image/gif;name=a.gif;base64,EEEE')).toEqual({
      mimeType: 'image/gif',
      data: 'EEEE',
    });
  });

  it('本体にカンマが含まれていても最初のカンマだけで切る', () => {
    expect(parseImageDataUrl('data:image/png;base64,FF,GG')).toEqual({
      mimeType: 'image/png',
      data: 'FF,GG',
    });
  });

  it('画像でないMIMEタイプのデータURLは弾く', () => {
    expect(parseImageDataUrl('data:application/pdf;base64,HHHH')).toBeNull();
    expect(parseImageDataUrl('data:text/plain,HHHH')).toBeNull();
  });

  it('接頭辞の無い生のbase64は、全体を本体・image/jpeg として扱う', () => {
    expect(parseImageDataUrl('IIII')).toEqual({ mimeType: 'image/jpeg', data: 'IIII' });
  });

  it('空文字は空のまま返す(呼び出し側がそのまま送り、APIが読み取り失敗を返す)', () => {
    expect(parseImageDataUrl('')).toEqual({ mimeType: 'image/jpeg', data: '' });
  });
});

/** Gemini へ送ったリクエスト1回ぶん(URLと本文)。 */
interface GeminiCall {
  url: string;
  payload: {
    generationConfig: { responseSchema: { properties: Record<string, unknown>; required: string[] } };
  };
}

/** Gemini の generateContent が JSON を返したことにする。呼ばれたURL・本文も覚える。 */
function stubGemini(status: number, body: unknown): { calls: GeminiCall[] } {
  const calls: GeminiCall[] = [];
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    calls.push({ url, payload: JSON.parse(init.body) });
    return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  });
  return { calls };
}

/** Gemini の応答(JSONをテキストパートに入れた形)を組み立てる。 */
function geminiResponse(payload: unknown) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] };
}

describe('GeminiAiPort.generateDailyReport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('設定したモデル名を記録用に返し、そのモデルを呼ぶ', async () => {
    const { calls } = stubGemini(200, geminiResponse({ warnings: [], internal: 'i', customer: 'c' }));
    const port = new GeminiAiPort({ apiKey: 'key', reportModel: 'gemini-test' });

    expect(port.reportModel).toBe('gemini-test');
    await port.generateDailyReport({ prompt: 'P', text: 'メモ' });
    expect(calls[0]?.url).toContain('/models/gemini-test:generateContent');
  });

  it('usedKeywords を応答スキーマに入れるが、必須にはしない', async () => {
    const { calls } = stubGemini(200, geminiResponse({ warnings: [], internal: 'i', customer: 'c' }));
    await new GeminiAiPort({ apiKey: 'key' }).generateDailyReport({ prompt: 'P', text: 'メモ' });

    const schema = calls[0]?.payload.generationConfig.responseSchema;
    expect(schema?.properties.usedKeywords).toEqual({ type: 'ARRAY', items: { type: 'STRING' } });
    expect(schema?.required).not.toContain('usedKeywords');
  });

  it('応答に usedKeywords が無ければ空配列にし、あればそのまま返す', async () => {
    stubGemini(200, geminiResponse({ warnings: [], internal: 'i', customer: 'c' }));
    const withoutKeywords = await new GeminiAiPort({ apiKey: 'key' }).generateDailyReport({
      prompt: 'P',
      text: 'メモ',
    });
    expect(withoutKeywords.usedKeywords).toEqual([]);
    expect(withoutKeywords.error).toBeUndefined();

    vi.unstubAllGlobals();
    stubGemini(200, geminiResponse({ warnings: [], internal: 'i', customer: 'c', usedKeywords: ['K01'] }));
    const withKeywords = await new GeminiAiPort({ apiKey: 'key' }).generateDailyReport({
      prompt: 'P',
      text: 'メモ',
    });
    // 候補やキーワード表と突き合わせず、AIが答えた通りに渡す(絞るのは記録側)。
    expect(withKeywords.usedKeywords).toEqual(['K01']);
  });

  it('API呼び出しが失敗したら、GAS版と同じ形に加えて error にも理由を入れる', async () => {
    stubGemini(429, 'rate limited');
    const draft = await new GeminiAiPort({ apiKey: 'key' }).generateDailyReport({
      prompt: 'P',
      text: 'メモ',
    });

    expect(draft.warnings).toEqual(['API Error']);
    expect(draft.internal).toContain('レート制限');
    expect(draft.customer).toBe('');
    expect(draft.usedKeywords).toEqual([]);
    expect(draft.error).toBe(draft.internal);
  });
});

describe('NoopReportAiPort', () => {
  it('APIキー未設定は生成の失敗として扱う(記録に理由が残る)', async () => {
    const port = new NoopReportAiPort();
    expect(port.reportModel).toBe('noop');

    const draft = await port.generateDailyReport();
    expect(draft.warnings).toEqual(['API Key Missing']);
    expect(draft.usedKeywords).toEqual([]);
    expect(draft.error).toBe('API Key Missing');
  });
});
