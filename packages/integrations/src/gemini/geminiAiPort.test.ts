import { describe, expect, it } from 'vitest';
import { parseImageDataUrl } from './geminiAiPort';

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
    expect(parseImageDataUrl('data:image/webp;base64,BBBB').mimeType).toBe('image/webp');
    expect(parseImageDataUrl('data:image/heic;base64,CCCC').mimeType).toBe('image/heic');
  });

  it('大文字表記のMIMEタイプは小文字に揃える', () => {
    expect(parseImageDataUrl('DATA:IMAGE/PNG;BASE64,DDDD')).toEqual({
      mimeType: 'image/png',
      data: 'DDDD',
    });
  });

  it('`;base64` が無いデータURLでも本体はカンマの後ろ全部', () => {
    expect(parseImageDataUrl('data:image/gif,EEEE')).toEqual({ mimeType: 'image/gif', data: 'EEEE' });
  });

  it('本体にカンマが含まれていても最初のカンマだけで切る', () => {
    expect(parseImageDataUrl('data:image/png;base64,FF,GG')).toEqual({
      mimeType: 'image/png',
      data: 'FF,GG',
    });
  });

  it('画像でないMIMEタイプは、カンマの後ろを本体・image/jpeg として扱う(GAS版と同じ)', () => {
    expect(parseImageDataUrl('data:application/pdf;base64,HHHH')).toEqual({
      mimeType: 'image/jpeg',
      data: 'HHHH',
    });
  });

  it('接頭辞の無い生のbase64は、全体を本体・image/jpeg として扱う', () => {
    expect(parseImageDataUrl('IIII')).toEqual({ mimeType: 'image/jpeg', data: 'IIII' });
  });

  it('空文字は空のまま返す(呼び出し側がそのまま送り、APIが読み取り失敗を返す)', () => {
    expect(parseImageDataUrl('')).toEqual({ mimeType: 'image/jpeg', data: '' });
  });
});
