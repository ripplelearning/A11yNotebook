import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt as scryptCallback } from 'node:crypto';
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const FORMAT = 'a11ynotebook-encrypted-v1';
const VERIFIER = 'a11ynotebook-password-check-v1';

export interface EncryptedRecord {
  format: typeof FORMAT;
  id: string;
  nonce: string;
  tag: string;
  ciphertext: string;
}

export interface VaultSecurityConfig {
  version: 1;
  salt: string;
  nonce: string;
  tag: string;
  verifier: string;
}

function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 8 || password.length > 1024) {
    throw new Error('Password must be between 8 and 1024 characters.');
  }
}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  validatePassword(password);
  if (salt.length !== SALT_BYTES) throw new Error('Invalid security salt.');
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

function domainKey(key: Buffer, domain: string) {
  return Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), `a11ynotebook:${domain}:v1`, KEY_BYTES));
}

function encryptBytes(key: Buffer, domain: string, id: string, plaintext: Buffer) {
  const nonce = randomBytes(NONCE_BYTES);
  const encryptionKey = domainKey(key, domain);
  try {
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(`${FORMAT}:${domain}:${id}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext };
  } finally {
    encryptionKey.fill(0);
  }
}

function decryptBytes(key: Buffer, domain: string, id: string, nonce: string, tag: string, ciphertext: string) {
  const nonceBytes = Buffer.from(nonce, 'base64');
  const tagBytes = Buffer.from(tag, 'base64');
  const encrypted = Buffer.from(ciphertext, 'base64');
  if (
    nonceBytes.length !== NONCE_BYTES ||
    tagBytes.length !== TAG_BYTES ||
    nonceBytes.toString('base64') !== nonce ||
    tagBytes.toString('base64') !== tag ||
    encrypted.toString('base64') !== ciphertext
  ) {
    throw new Error('Encrypted data is malformed.');
  }
  const decryptionKey = domainKey(key, domain);
  try {
    const decipher = createDecipheriv('aes-256-gcm', decryptionKey, nonceBytes, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(`${FORMAT}:${domain}:${id}`, 'utf8'));
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } finally {
    decryptionKey.fill(0);
  }
}

export async function createVaultSecurityConfig(password: string): Promise<{ config: VaultSecurityConfig; key: Buffer }> {
  validatePassword(password);
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt);
  const encryptedVerifier = encryptBytes(key, 'verifier', VERIFIER, Buffer.from(VERIFIER));
  return {
    key,
    config: {
      version: 1,
      salt: salt.toString('base64'),
      nonce: encryptedVerifier.nonce,
      tag: encryptedVerifier.tag,
      verifier: encryptedVerifier.ciphertext.toString('base64'),
    },
  };
}

export async function unlockVault(config: VaultSecurityConfig, password: string): Promise<Buffer> {
  if (
    !config ||
    config.version !== 1 ||
    typeof config.salt !== 'string' ||
    typeof config.nonce !== 'string' ||
    typeof config.tag !== 'string' ||
    typeof config.verifier !== 'string'
  ) {
    throw new Error('Vault security metadata is invalid.');
  }
  const salt = Buffer.from(config.salt, 'base64');
  if (salt.length !== SALT_BYTES || salt.toString('base64') !== config.salt) throw new Error('Vault security metadata is invalid.');
  const key = await deriveKey(password, salt);
  try {
    const verifier = decryptBytes(key, 'verifier', VERIFIER, config.nonce, config.tag, config.verifier);
    try {
      if (!verifier.equals(Buffer.from(VERIFIER))) throw new Error('Incorrect vault password.');
      return key;
    } finally {
      verifier.fill(0);
    }
  } catch {
    key.fill(0);
    throw new Error('Incorrect vault password or damaged security metadata.');
  }
}

export function encryptRecord(key: Buffer, domain: 'note' | 'credentials', id: string, plaintext: string): EncryptedRecord {
  if (key.length !== KEY_BYTES || !id || id.length > 512 || typeof plaintext !== 'string') {
    throw new Error('Invalid encrypted record.');
  }
  const encrypted = encryptBytes(key, domain, id, Buffer.from(plaintext, 'utf8'));
  return {
    format: FORMAT,
    id,
    nonce: encrypted.nonce,
    tag: encrypted.tag,
    ciphertext: encrypted.ciphertext.toString('base64'),
  };
}

export function decryptRecord(key: Buffer, domain: 'note' | 'credentials', value: unknown): string {
  if (
    key.length !== KEY_BYTES ||
    !value ||
    typeof value !== 'object' ||
    (value as EncryptedRecord).format !== FORMAT ||
    typeof (value as EncryptedRecord).id !== 'string' ||
    (value as EncryptedRecord).id.length > 512 ||
    typeof (value as EncryptedRecord).nonce !== 'string' ||
    typeof (value as EncryptedRecord).tag !== 'string' ||
    typeof (value as EncryptedRecord).ciphertext !== 'string'
  ) {
    throw new Error('Encrypted data is malformed.');
  }
  const record = value as EncryptedRecord;
  const plaintext = decryptBytes(key, domain, record.id, record.nonce, record.tag, record.ciphertext);
  try {
    return plaintext.toString('utf8');
  } finally {
    plaintext.fill(0);
  }
}

export function isEncryptedRecord(value: unknown): value is EncryptedRecord {
  return !!value && typeof value === 'object' && (value as EncryptedRecord).format === FORMAT;
}
