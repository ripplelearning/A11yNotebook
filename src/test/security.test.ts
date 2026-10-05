// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createVaultSecurityConfig,
  createVaultRecoveryKey,
  decryptPasswordEncryptedNote,
  decryptRecord,
  encryptRecord,
  encryptNoteWithPassword,
  isEncryptedRecord,
  isPasswordEncryptedNote,
  revokeVaultRecoveryKey,
  resetVaultPasswordWithRecovery,
  reencryptPasswordNote,
  unlockVaultWithRecovery,
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

  it('supports legacy vault metadata and independently wrapped random vault keys', async () => {
    const legacyConfig = {
      version: 1 as const,
      salt: 'AAECAwQFBgcICQoLDA0ODw==',
      nonce: 'AAECAwQFBgcICQoL',
      tag: 'AZqDLrZBHtnJqzb2r2Rt8g==',
      verifier: 'oytFLSZmGPZ3WSfoca4Ew6RWd0d9gpcOIGCu9XI6',
    };
    const legacyKey = await unlockVault(legacyConfig, 'legacy vault password');
    const { config, key } = await createVaultSecurityConfig('correct horse battery');
    expect(config.version).toBe(2);
    expect(config.version === 2 && config.wrappedKey).toBeDefined();
    expect(key.equals(legacyKey)).toBe(false);
    const reopened = await unlockVault(config, 'correct horse battery');
    expect(reopened.equals(key)).toBe(true);
    legacyKey.fill(0);
    key.fill(0);
    reopened.fill(0);
  });

  it('authenticates, rotates, revokes, and resets access with recovery material', async () => {
    const { config: passwordConfig, key } = await createVaultSecurityConfig('old vault password');
    const first = createVaultRecoveryKey(passwordConfig, key);
    const recovered = unlockVaultWithRecovery(first.config, first.recoveryKey);
    expect(recovered.equals(key)).toBe(true);
    const rotated = createVaultRecoveryKey(first.config, key);
    expect(rotated.recoveryKey).not.toBe(first.recoveryKey);
    expect(() => unlockVaultWithRecovery(rotated.config, first.recoveryKey)).toThrow(/incorrect|damaged/i);
    const reset = await resetVaultPasswordWithRecovery(rotated.config, rotated.recoveryKey, 'new vault password');
    expect(reset.key.equals(key)).toBe(true);
    expect((await unlockVault(reset.config, 'new vault password')).equals(key)).toBe(true);
    await expect(unlockVault(reset.config, 'old vault password')).rejects.toThrow(/Incorrect vault password/);
    const revoked = revokeVaultRecoveryKey(reset.config);
    expect(() => unlockVaultWithRecovery(revoked, rotated.recoveryKey)).toThrow(/not configured/);
    for (const item of [key, recovered, reset.key]) item.fill(0);
  });

  it('rejects malformed and tampered recovery envelopes', async () => {
    const { config, key } = await createVaultSecurityConfig('correct horse battery');
    const { config: configured, recoveryKey } = createVaultRecoveryKey(config, key);
    expect(() => unlockVaultWithRecovery(configured, 'not-a-recovery-key')).toThrow(/invalid/i);
    expect(() => unlockVaultWithRecovery(configured, recoveryKey.slice(0, -1))).toThrow(/invalid/i);
    expect(() =>
      unlockVaultWithRecovery(
        { ...configured, recovery: { ...configured.recovery!, ciphertext: `${configured.recovery!.ciphertext}A` } },
        recoveryKey,
      ),
    ).toThrow(/incorrect|damaged/i);
    key.fill(0);
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
