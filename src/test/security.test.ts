// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createVaultSecurityConfig,
  decryptPasswordEncryptedNote,
  decryptRecord,
  encryptRecord,
  encryptNoteWithPassword,
  isEncryptedRecord,
  isPasswordEncryptedNote,
  generateVaultRecoveryKey,
  prepareVaultRecovery,
  resetVaultPasswordWithRecovery,
  rotateVaultRecoveryKey,
  unlockVaultWithRecovery,
  unwrapLegacyVaultKey,
  reencryptPasswordNote,
  unlockPasswordEncryptedNote,
  unlockVault,
} from '../../electron/vault/security';

describe('vault security primitives', () => {
  it('derives a vault key and authenticates the password', async () => {
    const { config, key } = await createVaultSecurityConfig('correct horse battery');
    const unlocked = await unlockVault(config, 'correct horse battery');
    expect(unlocked.equals(key)).toBe(true);
    key.fill(0);
    unlocked.fill(0);
    await expect(unlockVault(config, 'incorrect password')).rejects.toThrow(/Incorrect vault password/);
  });

  it('uses authenticated, domain-separated encrypted records', async () => {
    const { key } = await createVaultSecurityConfig('correct horse battery');
    const record = encryptRecord(key, 'note', 'record-1', 'private note');
    expect(isEncryptedRecord(record)).toBe(true);
    expect(decryptRecord(key, 'note', record)).toBe('private note');
    expect(() => decryptRecord(key, 'credentials', record)).toThrow();
    expect(() => decryptRecord(key, 'note', { ...record, id: 'record-2' })).toThrow();
    expect(() => decryptRecord(key, 'note', { ...record, ciphertext: `${record.ciphertext}x` })).toThrow();
    key.fill(0);
  });

  it('rejects weak passwords and invalid configurations', async () => {
    await expect(createVaultSecurityConfig('short')).rejects.toThrow(/between 8/);
    await expect(
      unlockVault({ version: 1, salt: 'bad', nonce: '', tag: '', verifier: '' }, 'long enough password'),
    ).rejects.toThrow(/metadata is invalid/);
  });

  it('migrates a legacy vault key and credentials atomically into a recoverable key envelope', async () => {
    const legacy = await createVaultSecurityConfig('correct horse battery');
    const recoveryKey = generateVaultRecoveryKey();
    const credentials = JSON.stringify([{ id: 'service', username: 'user', password: 'credential secret' }]);
    const migrated = await prepareVaultRecovery(legacy.config, 'correct horse battery', recoveryKey, credentials);
    expect(migrated.config.version).toBe(2);
    expect(migrated.config.credentials).not.toBeNull();
    expect(decryptRecord(migrated.key, 'credentials', migrated.config.credentials)).toBe(credentials);
    expect(unwrapLegacyVaultKey(migrated.config, migrated.key)?.equals(legacy.key)).toBe(true);
    const recovered = await unlockVaultWithRecovery(migrated.config, recoveryKey);
    expect(recovered.equals(migrated.key)).toBe(true);
    await expect(unlockVaultWithRecovery(migrated.config, generateVaultRecoveryKey())).rejects.toThrow(/Recovery key/);
    await expect(unlockVaultWithRecovery(migrated.config, 'malformed')).rejects.toThrow(/Recovery key/);
    recovered.fill(0);
    migrated.key.fill(0);
    legacy.key.fill(0);
  });

  it('resets the password and supports recovery-key rotation and revocation', async () => {
    const legacy = await createVaultSecurityConfig('correct horse battery');
    const oldRecoveryKey = generateVaultRecoveryKey();
    const migrated = await prepareVaultRecovery(legacy.config, 'correct horse battery', oldRecoveryKey, null);
    const reset = await resetVaultPasswordWithRecovery(migrated.config, oldRecoveryKey, 'new vault password');
    await expect(unlockVault(reset.config, 'correct horse battery')).rejects.toThrow(/Incorrect vault password/);
    expect((await unlockVault(reset.config, 'new vault password')).equals(reset.key)).toBe(true);
    const newRecoveryKey = generateVaultRecoveryKey();
    const rotated = rotateVaultRecoveryKey(reset.config, reset.key, newRecoveryKey);
    await expect(unlockVaultWithRecovery(rotated, oldRecoveryKey)).rejects.toThrow(/Recovery key/);
    expect((await unlockVaultWithRecovery(rotated, newRecoveryKey)).equals(reset.key)).toBe(true);
    const revoked = rotateVaultRecoveryKey(rotated, reset.key, null);
    await expect(unlockVaultWithRecovery(revoked, newRecoveryKey)).rejects.toThrow(/not configured/);
    reset.key.fill(0);
    migrated.key.fill(0);
    legacy.key.fill(0);
  });

  it('encrypts notes with independent passwords and authenticates subsequent edits', async () => {
    const { record, key } = await encryptNoteWithPassword('note-specific password', 'private note', 'note-1');
    expect(isPasswordEncryptedNote(record)).toBe(true);
    expect(decryptPasswordEncryptedNote(key, record)).toBe('private note');
    await expect(unlockPasswordEncryptedNote('incorrect note password', record)).rejects.toThrow(
      /Incorrect note password/,
    );

    const unlocked = await unlockPasswordEncryptedNote('note-specific password', record);
    expect(unlocked.plaintext).toBe('private note');
    const updated = reencryptPasswordNote(unlocked.key, record, 'updated private note');
    expect(updated.id).toBe(record.id);
    expect(updated.salt).toBe(record.salt);
    expect(decryptPasswordEncryptedNote(unlocked.key, updated)).toBe('updated private note');
    key.fill(0);
    unlocked.key.fill(0);
  });

  it('rejects malformed password-encrypted note envelopes', async () => {
    const { record, key } = await encryptNoteWithPassword('note-specific password', 'private note', 'note-1');
    await expect(encryptNoteWithPassword('short', 'private note', 'note-2')).rejects.toThrow(/between 8/);
    await expect(unlockPasswordEncryptedNote('note-specific password', { ...record, salt: 'invalid' })).rejects.toThrow(
      /malformed/,
    );
    expect(() => decryptPasswordEncryptedNote(key, { ...record, ciphertext: `${record.ciphertext}x` })).toThrow(
      /malformed/,
    );
    key.fill(0);
  });
});
