import { gcm } from '@noble/ciphers/aes';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';

/**
 * `node:crypto` のブラウザ向け差し替え実装(デモビルドのvite aliasで注入する)。
 *
 * 目的は「本番と同じ暗号コードをそのままブラウザで動かす」こと。packages/core と
 * packages/integrations は node:crypto の**同期**API(createHash/createHmac/createCipheriv)を
 * 使っており、WebCryptoは全て非同期なので直接は代替できない。そこで同期実装を持つ
 * @noble/hashes と @noble/ciphers で node の API 形状だけを再現する。
 * 出力が node:crypto とバイト単位で一致することは nodeCryptoShim.test.ts で検証している。
 *
 * 実装しているのは本アプリが実際に使う範囲だけ(sha256 / hmac-sha256 / aes-256-gcm /
 * 乱数)。未対応の引数が来たら黙って違う結果を返さず、必ず例外を投げる。
 */

type BinaryLike = string | Uint8Array;
type Encoding = 'utf8' | 'hex' | 'base64';

function toBytes(data: BinaryLike, encoding?: Encoding): Uint8Array {
  if (typeof data !== 'string') return data;
  if (encoding && encoding !== 'utf8') {
    return new Uint8Array(Buffer.from(data, encoding));
  }
  return new TextEncoder().encode(data);
}

function assertSha256(algorithm: string): void {
  if (algorithm !== 'sha256') {
    throw new Error(`デモ用node:cryptoシムはsha256のみ対応しています(指定: ${algorithm})。`);
  }
}

function assertAes256Gcm(algorithm: string): void {
  if (algorithm !== 'aes-256-gcm') {
    throw new Error(`デモ用node:cryptoシムはaes-256-gcmのみ対応しています(指定: ${algorithm})。`);
  }
}

class Hash {
  private readonly chunks: Uint8Array[] = [];

  update(data: BinaryLike, encoding?: Encoding): this {
    this.chunks.push(toBytes(data, encoding));
    return this;
  }

  digest(): Buffer;
  digest(encoding: 'hex'): string;
  digest(encoding?: 'hex'): Buffer | string {
    const digest = Buffer.from(sha256(Buffer.concat(this.chunks)));
    return encoding === 'hex' ? digest.toString('hex') : digest;
  }
}

class Hmac {
  private readonly chunks: Uint8Array[] = [];

  constructor(private readonly key: Uint8Array) {}

  update(data: BinaryLike, encoding?: Encoding): this {
    this.chunks.push(toBytes(data, encoding));
    return this;
  }

  digest(): Buffer;
  digest(encoding: 'hex'): string;
  digest(encoding?: 'hex'): Buffer | string {
    const digest = Buffer.from(hmac(sha256, this.key, Buffer.concat(this.chunks)));
    return encoding === 'hex' ? digest.toString('hex') : digest;
  }
}

const GCM_TAG_LENGTH = 16;

/**
 * nodeのCipherは逐次的に暗号文を吐くが、@noble/ciphersは一括変換しか持たない。
 * 呼び出し側(LocalCryptoPort/LocalKmsPort)は `Buffer.concat([cipher.update(x), cipher.final()])`
 * の形でしか使っていないため、update()では入力を溜めるだけにして final() で一括処理する。
 */
class Cipher {
  private readonly chunks: Uint8Array[] = [];
  private authTag: Uint8Array | null = null;

  constructor(
    private readonly key: Uint8Array,
    private readonly nonce: Uint8Array,
  ) {}

  update(data: BinaryLike, encoding?: Encoding): Buffer {
    this.chunks.push(toBytes(data, encoding));
    return Buffer.alloc(0);
  }

  final(): Buffer {
    // noble の encrypt は 暗号文 || 認証タグ(16バイト) を返すので、nodeと同じ形に分解する。
    const sealed = gcm(this.key, this.nonce).encrypt(Buffer.concat(this.chunks));
    this.authTag = sealed.subarray(sealed.length - GCM_TAG_LENGTH);
    return Buffer.from(sealed.subarray(0, sealed.length - GCM_TAG_LENGTH));
  }

  getAuthTag(): Buffer {
    if (!this.authTag) throw new Error('getAuthTag()はfinal()の後に呼んでください。');
    return Buffer.from(this.authTag);
  }
}

class Decipher {
  private readonly chunks: Uint8Array[] = [];
  private authTag: Uint8Array | null = null;

  constructor(
    private readonly key: Uint8Array,
    private readonly nonce: Uint8Array,
  ) {}

  setAuthTag(tag: Uint8Array): this {
    this.authTag = tag;
    return this;
  }

  update(data: BinaryLike, encoding?: Encoding): Buffer {
    this.chunks.push(toBytes(data, encoding));
    return Buffer.alloc(0);
  }

  final(): Buffer {
    if (!this.authTag) throw new Error('setAuthTag()をfinal()より前に呼んでください。');
    const sealed = Buffer.concat([...this.chunks, this.authTag]);
    return Buffer.from(gcm(this.key, this.nonce).decrypt(sealed));
  }
}

export function createHash(algorithm: string): Hash {
  assertSha256(algorithm);
  return new Hash();
}

export function createHmac(algorithm: string, key: Uint8Array): Hmac {
  assertSha256(algorithm);
  return new Hmac(key);
}

export function createCipheriv(algorithm: string, key: Uint8Array, nonce: Uint8Array): Cipher {
  assertAes256Gcm(algorithm);
  return new Cipher(key, nonce);
}

export function createDecipheriv(algorithm: string, key: Uint8Array, nonce: Uint8Array): Decipher {
  assertAes256Gcm(algorithm);
  return new Decipher(key, nonce);
}

export function randomBytes(size: number): Buffer {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(size)));
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

export default {
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
};
