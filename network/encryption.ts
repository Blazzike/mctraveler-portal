import { dlopen, FFIType, ptr } from 'bun:ffi';
import crypto from 'node:crypto';
import forge from 'node-forge';

export interface ServerKeyPair {
  publicKey: Buffer;
  privateKey: crypto.KeyObject;
}

/** Generate RSA-1024 key pair for Minecraft protocol encryption. */
export function generateServerKeyPair(): ServerKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: {
      type: 'spki',
      format: 'der',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  return {
    publicKey: publicKey as Buffer,
    privateKey: crypto.createPrivateKey(privateKey),
  };
}

/** Decrypt with RSA PKCS#1 v1.5 padding. Uses forge (Bun crypto deprecated PKCS1 for private decrypt). */
export function rsaDecrypt(privateKey: crypto.KeyObject, encrypted: Buffer): Buffer {
  const privateKeyPem = privateKey.export({
    type: 'pkcs1',
    format: 'pem',
  }) as string;
  const forgePrivateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const decrypted = forgePrivateKey.decrypt(encrypted.toString('binary'), 'RSAES-PKCS1-V1_5');
  return Buffer.from(decrypted, 'binary');
}

// Try to load OpenSSL for native CFB8 support
const opensslLib = (() => {
  const libNames =
    process.platform === 'win32'
      ? ['libcrypto.dll', 'libcrypto-3-x64.dll', 'libeay32.dll']
      : process.platform === 'darwin'
        ? ['libcrypto.dylib', 'libcrypto.3.dylib', 'libcrypto.1.1.dylib']
        : ['libcrypto.so', 'libcrypto.so.3', 'libcrypto.so.1.1'];

  for (const name of libNames) {
    try {
      return dlopen(name, {
        EVP_CIPHER_CTX_new: { returns: FFIType.ptr },
        EVP_CIPHER_CTX_free: { args: [FFIType.ptr], returns: FFIType.void },
        EVP_aes_128_cfb8: { returns: FFIType.ptr },
        EVP_EncryptInit_ex: {
          args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
          returns: FFIType.i32,
        },
        EVP_DecryptInit_ex: {
          args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
          returns: FFIType.i32,
        },
        EVP_EncryptUpdate: {
          args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32],
          returns: FFIType.i32,
        },
        EVP_DecryptUpdate: {
          args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32],
          returns: FFIType.i32,
        },
      });
    } catch {
      // Try next library name
    }
  }
  return null;
})();

const hasNativeCFB8 = (() => {
  try {
    crypto.createCipheriv('aes-128-cfb8', Buffer.alloc(16), Buffer.alloc(16));
    return true;
  } catch {
    if (opensslLib) {
      console.log('[Encryption] Using OpenSSL FFI for CFB8');
    } else {
      console.warn('[Encryption] Using manual CFB8 (slow - consider Node.js for production)');
    }
    return false;
  }
})();

const hasOpenSSLCFB8 = !hasNativeCFB8 && opensslLib !== null;

export function isUsingNativeCFB8(): boolean {
  return hasNativeCFB8;
}

class CFB8CipherNative {
  private cipher: crypto.Cipheriv;

  constructor(key: Buffer, iv: Buffer) {
    this.cipher = crypto.createCipheriv('aes-128-cfb8', key, iv);
    this.cipher.setAutoPadding(false);
  }

  update(plaintext: Buffer): Buffer {
    return this.cipher.update(plaintext);
  }
}

class CFB8CipherOpenSSL {
  private ctx: ReturnType<typeof ptr>;
  private outLenBuf: Int32Array;

  constructor(key: Buffer, iv: Buffer) {
    const lib = opensslLib!;
    this.ctx = lib.symbols.EVP_CIPHER_CTX_new() as ReturnType<typeof ptr>;
    this.outLenBuf = new Int32Array(1);
    const cipher = lib.symbols.EVP_aes_128_cfb8() as ReturnType<typeof ptr>;
    lib.symbols.EVP_EncryptInit_ex(this.ctx, cipher, null, ptr(key), ptr(iv));
  }

  update(plaintext: Buffer): Buffer {
    if (plaintext.length === 0) return Buffer.alloc(0);
    const lib = opensslLib!;
    const ciphertext = Buffer.allocUnsafe(plaintext.length);
    lib.symbols.EVP_EncryptUpdate(this.ctx, ptr(ciphertext), ptr(new Uint8Array(this.outLenBuf.buffer)), ptr(plaintext), plaintext.length);
    return ciphertext;
  }
}

class CFB8CipherManual {
  private iv: Buffer;
  private cipher: crypto.Cipheriv;
  private encryptedIV: Buffer;

  constructor(key: Buffer, iv: Buffer) {
    this.iv = Buffer.from(iv);
    this.cipher = crypto.createCipheriv('aes-128-ecb', key, null);
    this.cipher.setAutoPadding(false);
    this.encryptedIV = Buffer.allocUnsafe(16);
  }

  update(plaintext: Buffer): Buffer {
    const len = plaintext.length;
    const ciphertext = Buffer.allocUnsafe(len);
    const iv = this.iv;
    const cipher = this.cipher;
    const encBuf = this.encryptedIV;

    for (let i = 0; i < len; i++) {
      cipher.update(iv).copy(encBuf);
      const ciphByte = encBuf[0]! ^ plaintext[i]!;
      ciphertext[i] = ciphByte;
      iv.copyWithin(0, 1);
      iv[15] = ciphByte;
    }

    return ciphertext;
  }
}

class CFB8DecipherNative {
  private decipher: crypto.Decipheriv;

  constructor(key: Buffer, iv: Buffer) {
    this.decipher = crypto.createDecipheriv('aes-128-cfb8', key, iv);
    this.decipher.setAutoPadding(false);
  }

  update(ciphertext: Buffer): Buffer {
    return this.decipher.update(ciphertext);
  }
}

class CFB8DecipherOpenSSL {
  private ctx: ReturnType<typeof ptr>;
  private outLenBuf: Int32Array;

  constructor(key: Buffer, iv: Buffer) {
    const lib = opensslLib!;
    this.ctx = lib.symbols.EVP_CIPHER_CTX_new() as ReturnType<typeof ptr>;
    this.outLenBuf = new Int32Array(1);
    const cipher = lib.symbols.EVP_aes_128_cfb8() as ReturnType<typeof ptr>;
    lib.symbols.EVP_DecryptInit_ex(this.ctx, cipher, null, ptr(key), ptr(iv));
  }

  update(ciphertext: Buffer): Buffer {
    if (ciphertext.length === 0) return Buffer.alloc(0);
    const lib = opensslLib!;
    const plaintext = Buffer.allocUnsafe(ciphertext.length);
    lib.symbols.EVP_DecryptUpdate(this.ctx, ptr(plaintext), ptr(new Uint8Array(this.outLenBuf.buffer)), ptr(ciphertext), ciphertext.length);
    return plaintext;
  }
}

class CFB8DecipherManual {
  private iv: Buffer;
  private cipher: crypto.Cipheriv;
  private encryptedIV: Buffer;

  constructor(key: Buffer, iv: Buffer) {
    this.iv = Buffer.from(iv);
    this.cipher = crypto.createCipheriv('aes-128-ecb', key, null);
    this.cipher.setAutoPadding(false);
    this.encryptedIV = Buffer.allocUnsafe(16);
  }

  update(ciphertext: Buffer): Buffer {
    const len = ciphertext.length;
    const plaintext = Buffer.allocUnsafe(len);
    const iv = this.iv;
    const cipher = this.cipher;
    const encBuf = this.encryptedIV;

    for (let i = 0; i < len; i++) {
      cipher.update(iv).copy(encBuf);
      const ciphByte = ciphertext[i]!;
      plaintext[i] = encBuf[0]! ^ ciphByte;
      iv.copyWithin(0, 1);
      iv[15] = ciphByte;
    }

    return plaintext;
  }
}

export function createCipher(sharedSecret: Buffer) {
  if (hasNativeCFB8) {
    return new CFB8CipherNative(sharedSecret, sharedSecret);
  }
  if (hasOpenSSLCFB8) {
    return new CFB8CipherOpenSSL(sharedSecret, sharedSecret);
  }
  return new CFB8CipherManual(sharedSecret, sharedSecret);
}

export function createDecipher(sharedSecret: Buffer) {
  if (hasNativeCFB8) {
    return new CFB8DecipherNative(sharedSecret, sharedSecret);
  }
  if (hasOpenSSLCFB8) {
    return new CFB8DecipherOpenSSL(sharedSecret, sharedSecret);
  }
  return new CFB8DecipherManual(sharedSecret, sharedSecret);
}

/** Enable CFB8 encryption on socket. Intercepts writes and stores decipher for reads. */
export function enableEncryption(socket: any, sharedSecret: Buffer): void {
  const cipher = createCipher(sharedSecret);
  const decipher = createDecipher(sharedSecret);

  // Intercept writes to encrypt outgoing data
  const originalWrite = socket.write.bind(socket);
  socket.write = (data: Buffer, ...args: any[]) => {
    const encrypted = cipher.update(data);
    return originalWrite(encrypted, ...args);
  };

  // Store decipher for incoming data decryption
  socket._encryptionDecipher = decipher;
  socket._encryptionEnabled = true;
}
