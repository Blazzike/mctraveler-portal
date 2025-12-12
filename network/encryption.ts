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

const hasNativeCFB8 = (() => {
  try {
    crypto.createCipheriv('aes-128-cfb8', Buffer.alloc(16), Buffer.alloc(16));
    return true;
  } catch {
    console.warn('[Encryption] Using manual CFB8 (slow - consider Node.js for production)');
    return false;
  }
})();

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

class CFB8CipherManual {
  private iv: Buffer;
  private cipher: crypto.Cipheriv;
  private ivBuffer: Buffer;

  constructor(key: Buffer, iv: Buffer) {
    this.iv = Buffer.from(iv);
    this.cipher = crypto.createCipheriv('aes-128-ecb', key, null);
    this.cipher.setAutoPadding(false);
    this.ivBuffer = Buffer.allocUnsafe(16);
  }

  update(plaintext: Buffer): Buffer {
    const len = plaintext.length;
    const ciphertext = Buffer.allocUnsafe(len);
    const iv = this.iv;
    const ivBuf = this.ivBuffer;
    const cipher = this.cipher;

    for (let i = 0; i < len; i++) {
      iv.copy(ivBuf, 0, 0, 16);
      const encryptedIV = cipher.update(ivBuf);
      const ciphByte = encryptedIV[0]! ^ plaintext[i]!;
      ciphertext[i] = ciphByte;
      iv.copy(iv, 0, 1, 16);
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

class CFB8DecipherManual {
  private iv: Buffer;
  private cipher: crypto.Cipheriv;
  private ivBuffer: Buffer;

  constructor(key: Buffer, iv: Buffer) {
    this.iv = Buffer.from(iv);
    this.cipher = crypto.createCipheriv('aes-128-ecb', key, null);
    this.cipher.setAutoPadding(false);
    this.ivBuffer = Buffer.allocUnsafe(16);
  }

  update(ciphertext: Buffer): Buffer {
    const len = ciphertext.length;
    const plaintext = Buffer.allocUnsafe(len);
    const iv = this.iv;
    const ivBuf = this.ivBuffer;
    const cipher = this.cipher;

    for (let i = 0; i < len; i++) {
      iv.copy(ivBuf, 0, 0, 16);
      const encryptedIV = cipher.update(ivBuf);
      const ciphByte = ciphertext[i]!;
      plaintext[i] = encryptedIV[0]! ^ ciphByte;
      iv.copy(iv, 0, 1, 16);
      iv[15] = ciphByte;
    }

    return plaintext;
  }
}

export function createCipher(sharedSecret: Buffer) {
  if (hasNativeCFB8) {
    return new CFB8CipherNative(sharedSecret, sharedSecret);
  }
  return new CFB8CipherManual(sharedSecret, sharedSecret);
}

export function createDecipher(sharedSecret: Buffer) {
  if (hasNativeCFB8) {
    return new CFB8DecipherNative(sharedSecret, sharedSecret);
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
