import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt as scryptCallback } from 'node:crypto';
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const FORMAT = 'a11ynotebook-encrypted-v1';
const PASSWORD_NOTE_FORMAT = 'a11ynotebook-password-note-v1';
const VERIFIER = 'a11ynotebook-password-check-v1';

export interface EncryptedRecord {
  format: typeof FORMAT;
  id: string;
  nonce: string;
  tag: string;
  ciphertext: string;
}

export interface PasswordEncryptedNote {
  format: typeof PASSWORD_NOTE_FORMAT;
  id: string;
  salt: string;
  nonce: string;
  tag: string;
  ciphertext: string;
}

interface VaultSecurityConfigV1 {
  version: 1;
  salt: string;
  nonce: string;
  tag: string;
  verifier: string;
}

export interface RecoveryEnvelope {
  nonce: string;
  tag: string;
  ciphertext: string;
}

interface VaultSecurityConfigV2 {
  version: 2;
  salt: string;
  nonce: string;
  tag: string;
  verifier: string;
  wrappedKey: RecoveryEnvelope;
  recovery?: RecoveryEnvelope;
}

export type VaultSecurityConfig = VaultSecurityConfigV1 | VaultSecurityConfigV2;

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

function encryptBytes(key: Buffer, domain: string, id: string, plaintext: Buffer, format = FORMAT) {
  const nonce = randomBytes(NONCE_BYTES);
  const encryptionKey = domainKey(key, domain);
  try {
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(`${format}:${domain}:${id}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext };
  } finally {
    encryptionKey.fill(0);
  }
}

function decryptBytes(
  key: Buffer,
  domain: string,
  id: string,
  nonce: string,
  tag: string,
  ciphertext: string,
  format = FORMAT,
) {
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
    decipher.setAAD(Buffer.from(`${format}:${domain}:${id}`, 'utf8'));
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } finally {
    decryptionKey.fill(0);
  }
}

export async function createVaultSecurityConfig(
  password: string,
): Promise<{ config: VaultSecurityConfig; key: Buffer }> {
  validatePassword(password);
  const salt = randomBytes(SALT_BYTES);
  const key = randomBytes(KEY_BYTES);
  const passwordKey = await deriveKey(password, salt);
  try {
    const encryptedVerifier = encryptBytes(passwordKey, 'password-auth-v2', VERIFIER, Buffer.from(VERIFIER));
    const wrappedKey = encryptBytes(passwordKey, 'password-wrap-v2', 'vault-data-key-v2', key);
    return {
      key,
      config: {
        version: 2,
        salt: salt.toString('base64'),
        nonce: encryptedVerifier.nonce,
        tag: encryptedVerifier.tag,
        verifier: encryptedVerifier.ciphertext.toString('base64'),
        wrappedKey: {
          nonce: wrappedKey.nonce,
          tag: wrappedKey.tag,
          ciphertext: wrappedKey.ciphertext.toString('base64'),
        },
      },
    };
  } catch (error) {
    key.fill(0);
    throw error;
  } finally {
    passwordKey.fill(0);
  }
}

export async function unlockVault(config: VaultSecurityConfig, password: string): Promise<Buffer> {
  if (
    !config ||
    (config.version !== 1 && config.version !== 2) ||
    typeof config.salt !== 'string' ||
    typeof config.nonce !== 'string' ||
    typeof config.tag !== 'string' ||
    typeof config.verifier !== 'string'
  ) {
    throw new Error('Vault security metadata is invalid.');
  }
  if (
    config.version === 2 &&
    (!config.wrappedKey ||
      typeof config.wrappedKey.nonce !== 'string' ||
      typeof config.wrappedKey.tag !== 'string' ||
      typeof config.wrappedKey.ciphertext !== 'string')
  ) {
    throw new Error('Vault security metadata is invalid.');
  }
  const salt = Buffer.from(config.salt, 'base64');
  if (salt.length !== SALT_BYTES || salt.toString('base64') !== config.salt)
    throw new Error('Vault security metadata is invalid.');
  const key = await deriveKey(password, salt);
  try {
    const verifier = decryptBytes(
      key,
      config.version === 1 ? 'verifier' : 'password-auth-v2',
      VERIFIER,
      config.nonce,
      config.tag,
      config.verifier,
    );
    try {
      if (!verifier.equals(Buffer.from(VERIFIER))) throw new Error('Incorrect vault password.');
    } finally {
      verifier.fill(0);
    }
    if (config.version === 1) return key;
    const dataKey = decryptBytes(
      key,
      'password-wrap-v2',
      'vault-data-key-v2',
      config.wrappedKey.nonce,
      config.wrappedKey.tag,
      config.wrappedKey.ciphertext,
    );
    if (dataKey.length !== KEY_BYTES) {
      dataKey.fill(0);
      throw new Error('Invalid vault data key.');
    }
    return dataKey;
  } catch {
    key.fill(0);
    throw new Error('Incorrect vault password or damaged security metadata.');
  }
}

function validateRecoveryKey(value: unknown): Buffer {
  if (typeof value !== 'string') throw new Error('Recovery key is invalid.');
  const normalized = value.replace(/[\s-]/g, '').toLowerCase();
  if (!/^[\da-f]{64}$/.test(normalized)) throw new Error('Recovery key is invalid.');
  return Buffer.from(normalized, 'hex');
}

function createRecoveryEnvelope(dataKey: Buffer, recoveryMaterial: Buffer): RecoveryEnvelope {
  if (dataKey.length !== KEY_BYTES || recoveryMaterial.length !== KEY_BYTES) throw new Error('Invalid recovery key.');
  const envelope = encryptBytes(recoveryMaterial, 'recovery-wrap-v2', 'vault-data-key-v2', dataKey);
  return {
    nonce: envelope.nonce,
    tag: envelope.tag,
    ciphertext: envelope.ciphertext.toString('base64'),
  };
}

export function createVaultRecoveryKey(config: VaultSecurityConfig, dataKey: Buffer) {
  if (config.version !== 2 || dataKey.length !== KEY_BYTES) throw new Error('This vault cannot use recovery keys.');
  const recoveryMaterial = randomBytes(KEY_BYTES);
  try {
    const recoveryKey = recoveryMaterial.toString('hex').toUpperCase().match(/.{1,8}/g)!.join('-');
    return {
      recoveryKey,
      config: { ...config, recovery: createRecoveryEnvelope(dataKey, recoveryMaterial) },
    };
  } finally {
    recoveryMaterial.fill(0);
  }
}

export function revokeVaultRecoveryKey(config: VaultSecurityConfig): VaultSecurityConfig {
  if (config.version !== 2) throw new Error('This vault cannot use recovery keys.');
  const { recovery: _recovery, ...withoutRecovery } = config;
  return withoutRecovery;
}

export function unlockVaultWithRecovery(config: VaultSecurityConfig, recoveryKey: unknown): Buffer {
  if (config.version !== 2 || !config.recovery) throw new Error('A recovery key is not configured for this vault.');
  const material = validateRecoveryKey(recoveryKey);
  try {
    const dataKey = decryptBytes(
      material,
      'recovery-wrap-v2',
      'vault-data-key-v2',
      config.recovery.nonce,
      config.recovery.tag,
      config.recovery.ciphertext,
    );
    if (dataKey.length !== KEY_BYTES) {
      dataKey.fill(0);
      throw new Error('Invalid recovery key.');
    }
    return dataKey;
  } catch {
    throw new Error('The recovery key is incorrect or the recovery data is damaged.');
  } finally {
    material.fill(0);
  }
}

export async function resetVaultPasswordWithRecovery(
  config: VaultSecurityConfig,
  recoveryKey: unknown,
  password: string,
): Promise<{ config: VaultSecurityConfig; key: Buffer }> {
  validatePassword(password);
  const key = unlockVaultWithRecovery(config, recoveryKey);
  const salt = randomBytes(SALT_BYTES);
  const passwordKey = await deriveKey(password, salt);
  try {
    const verifier = encryptBytes(passwordKey, 'password-auth-v2', VERIFIER, Buffer.from(VERIFIER));
    const wrappedKey = encryptBytes(passwordKey, 'password-wrap-v2', 'vault-data-key-v2', key);
    return {
      key,
      config: {
        version: 2,
        salt: salt.toString('base64'),
        nonce: verifier.nonce,
        tag: verifier.tag,
        verifier: verifier.ciphertext.toString('base64'),
        wrappedKey: {
          nonce: wrappedKey.nonce,
          tag: wrappedKey.tag,
          ciphertext: wrappedKey.ciphertext.toString('base64'),
        },
        ...(config.version === 2 && config.recovery ? { recovery: config.recovery } : {}),
      },
    };
  } catch (error) {
    key.fill(0);
    throw error;
  } finally {
    passwordKey.fill(0);
  }
}

export function encryptRecord(
  key: Buffer,
  domain: 'note' | 'credentials',
  id: string,
  plaintext: string,
): EncryptedRecord {
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

export async function encryptNoteWithPassword(
  password: string,
  plaintext: string,
  id: string,
): Promise<{ record: PasswordEncryptedNote; key: Buffer }> {
  validatePassword(password);
  if (!id || id.length > 512 || typeof plaintext !== 'string') throw new Error('Invalid encrypted note.');
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt);
  try {
    const encrypted = encryptBytes(key, 'note', id, Buffer.from(plaintext, 'utf8'), PASSWORD_NOTE_FORMAT);
    return {
      key,
      record: {
        format: PASSWORD_NOTE_FORMAT,
        id,
        salt: salt.toString('base64'),
        nonce: encrypted.nonce,
        tag: encrypted.tag,
        ciphertext: encrypted.ciphertext.toString('base64'),
      },
    };
  } catch (error) {
    key.fill(0);
    throw error;
  }
}

function validatePasswordEncryptedNote(value: unknown): PasswordEncryptedNote {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as PasswordEncryptedNote).format !== PASSWORD_NOTE_FORMAT ||
    typeof (value as PasswordEncryptedNote).id !== 'string' ||
    !(value as PasswordEncryptedNote).id ||
    (value as PasswordEncryptedNote).id.length > 512 ||
    typeof (value as PasswordEncryptedNote).salt !== 'string' ||
    typeof (value as PasswordEncryptedNote).nonce !== 'string' ||
    typeof (value as PasswordEncryptedNote).tag !== 'string' ||
    typeof (value as PasswordEncryptedNote).ciphertext !== 'string'
  ) {
    throw new Error('Encrypted note is malformed.');
  }
  const record = value as PasswordEncryptedNote;
  const salt = Buffer.from(record.salt, 'base64');
  if (salt.length !== SALT_BYTES || salt.toString('base64') !== record.salt) {
    throw new Error('Encrypted note is malformed.');
  }
  return record;
}

export async function unlockPasswordEncryptedNote(
  password: string,
  value: unknown,
): Promise<{ key: Buffer; plaintext: string }> {
  validatePassword(password);
  const record = validatePasswordEncryptedNote(value);
  const key = await deriveKey(password, Buffer.from(record.salt, 'base64'));
  try {
    const plaintext = decryptBytes(
      key,
      'note',
      record.id,
      record.nonce,
      record.tag,
      record.ciphertext,
      PASSWORD_NOTE_FORMAT,
    );
    try {
      return { key, plaintext: plaintext.toString('utf8') };
    } finally {
      plaintext.fill(0);
    }
  } catch {
    key.fill(0);
    throw new Error('Incorrect note password or damaged encrypted note.');
  }
}

export function decryptPasswordEncryptedNote(key: Buffer, value: unknown): string {
  if (key.length !== KEY_BYTES) throw new Error('Invalid encrypted note key.');
  const record = validatePasswordEncryptedNote(value);
  const plaintext = decryptBytes(
    key,
    'note',
    record.id,
    record.nonce,
    record.tag,
    record.ciphertext,
    PASSWORD_NOTE_FORMAT,
  );
  try {
    return plaintext.toString('utf8');
  } finally {
    plaintext.fill(0);
  }
}

export function reencryptPasswordNote(key: Buffer, value: unknown, plaintext: string): PasswordEncryptedNote {
  if (key.length !== KEY_BYTES || typeof plaintext !== 'string') throw new Error('Invalid encrypted note update.');
  const record = validatePasswordEncryptedNote(value);
  const encrypted = encryptBytes(key, 'note', record.id, Buffer.from(plaintext, 'utf8'), PASSWORD_NOTE_FORMAT);
  return { ...record, nonce: encrypted.nonce, tag: encrypted.tag, ciphertext: encrypted.ciphertext.toString('base64') };
}

export function isPasswordEncryptedNote(value: unknown): value is PasswordEncryptedNote {
  return !!value && typeof value === 'object' && (value as PasswordEncryptedNote).format === PASSWORD_NOTE_FORMAT;
}

export function isEncryptedRecord(value: unknown): value is EncryptedRecord {
  return !!value && typeof value === 'object' && (value as EncryptedRecord).format === FORMAT;
}
