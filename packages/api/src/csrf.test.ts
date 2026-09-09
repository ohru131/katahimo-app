import { describe, expect, it } from 'vitest';
import { shouldRejectAsCrossSite } from './csrf';

const self = 'https://app.example.com/api/reports/daily';

describe('クロスサイトからの書き込みの拒否', () => {
  it('同一オリジンからの書き込みは通す', () => {
    expect(shouldRejectAsCrossSite('POST', 'https://app.example.com', self)).toBe(false);
  });

  it('別オリジンからの書き込みは拒否する', () => {
    expect(shouldRejectAsCrossSite('POST', 'https://evil.example.net', self)).toBe(true);
  });

  it('スキームやポートが違うだけでも別オリジンとして拒否する', () => {
    expect(shouldRejectAsCrossSite('POST', 'http://app.example.com', self)).toBe(true);
    expect(shouldRejectAsCrossSite('POST', 'https://app.example.com:8443', self)).toBe(true);
  });

  it('PUT/PATCH/DELETEも書き込みとして扱う', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(shouldRejectAsCrossSite(method, 'https://evil.example.net', self)).toBe(true);
    }
  });

  it('GET/HEAD/OPTIONSは照合しない(状態を変えないため)', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(shouldRejectAsCrossSite(method, 'https://evil.example.net', self)).toBe(false);
    }
  });

  it('Originが無い要求は拒否しない(ブラウザ発ではなくCSRFの経路にならないため)', () => {
    expect(shouldRejectAsCrossSite('POST', null, self)).toBe(false);
    expect(shouldRejectAsCrossSite('POST', undefined, self)).toBe(false);
  });

  it('明示的に許可したオリジンは通す', () => {
    expect(
      shouldRejectAsCrossSite('POST', 'https://admin.example.com', self, ['https://admin.example.com']),
    ).toBe(false);
  });

  it('TLSを手前で終端する構成でも、同一オリジンの書き込みを弾かない', () => {
    // Cloud Run等ではアプリに届くのは平文HTTPなので c.req.url は http:// になる。
    // ブラウザが送る Origin は https:// なので、転送元のスキームを見ないと誤って403になる。
    const behindProxy = 'http://app.example.com/api/reports/daily';
    expect(shouldRejectAsCrossSite('POST', 'https://app.example.com', behindProxy)).toBe(true);
    expect(shouldRejectAsCrossSite('POST', 'https://app.example.com', behindProxy, [], 'https')).toBe(false);
  });

  it('プロキシを重ねた場合は最も外側のスキームを使う', () => {
    const behindProxy = 'http://app.example.com/api/reports/daily';
    expect(shouldRejectAsCrossSite('POST', 'https://app.example.com', behindProxy, [], 'https, http')).toBe(
      false,
    );
  });

  it('転送元のスキームを見ても、別オリジンは弾いたままにする', () => {
    const behindProxy = 'http://app.example.com/api/reports/daily';
    expect(shouldRejectAsCrossSite('POST', 'https://evil.example.net', behindProxy, [], 'https')).toBe(true);
  });

  it('リクエストURLが解釈できない場合は通さない', () => {
    expect(shouldRejectAsCrossSite('POST', 'https://app.example.com', 'not-a-url')).toBe(true);
  });
});
