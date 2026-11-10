import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export function secretKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('MCP secrets must be base64-encoded 32-byte keys');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('Invalid MCP key');
  return key;
}

export function createVault(encryptionKey, lookupKey) {
  const encryption = secretKey(encryptionKey);
  const lookup = secretKey(lookupKey);
  return {
    seal(value, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encryption, iv);
      cipher.setAAD(Buffer.from(context));
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return JSON.stringify({ v: 1, iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
    },
    open(sealed, context) {
      try {
        const entry = JSON.parse(sealed);
        if (entry.v !== 1) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', encryption, Buffer.from(entry.iv, 'base64'));
        decipher.setAAD(Buffer.from(context));
        decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(entry.data, 'base64')), decipher.final()]).toString('utf8'));
      } catch { throw new Error('MCP encrypted storage could not be opened'); }
    },
    lookup(value) { return createHmac('sha256', lookup).update(value).digest('hex'); },
  };
}
