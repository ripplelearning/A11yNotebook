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
  generateVaultRecoveryKey,
  prepareVaultRecovery,
  resetVaultPasswordWithRecovery,
  rotateVaultRecoveryKey,
  unlockVaultWithRecovery,
  unwrapLegacyVaultKey,
  revokeVaultRecoveryKey,
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

  it('supports legacy vault metadata and independently wrapped random vault keys', async () => {
    const legacyConfig = {
      version: 1 as const,
      salt: 'AAECAwQFBgcICQoLDA0ODw==',
      nonce: 'AAECAwQFBgcICQoL',
      tag: 'AZqDLrZBHtnJqzb2r2Rt8g==',
      verifier: 'oytFLSZmGPZ3WSfoca4Ew6RWd0d9gpcOIGCu9XI6',
    };
    const legacyKey = await unlockVault(legacyConfig, 'legacy vault password');
    const { config, key } = await prepareVaultRecovery(
      legacyConfig,
      'legacy vault password',
      generateVaultRecoveryKey(),
      null,
    );
    expect(config.version).toBe(3);
    expect(config.wrappedDataKey).toBeDefined();
    expect(key.equals(legacyKey)).toBe(false);
    const reopened = await unlockVault(config, 'legacy vault password');
    expect(reopened.equals(key)).toBe(true);
    legacyKey.fill(0);
    key.fill(0);
    reopened.fill(0);
  });

  it('authenticates, rotates, revokes, and resets access with recovery material', async () => {
    const { config: passwordConfig, key: legacyKey } = await createVaultSecurityConfig('old vault password');
    const firstRecoveryKey = generateVaultRecoveryKey();
    const { config, key } = await prepareVaultRecovery(passwordConfig, 'old vault password', firstRecoveryKey, null);
    const recovered = await unlockVaultWithRecovery(config, firstRecoveryKey);
    expect(recovered.equals(key)).toBe(true);
    const rotatedRecoveryKey = generateVaultRecoveryKey();
    const rotated = rotateVaultRecoveryKey(config, key, rotatedRecoveryKey);
    expect(rotatedRecoveryKey).not.toBe(firstRecoveryKey);
    expect(() => unlockVaultWithRecovery(rotated, firstRecoveryKey)).toThrow(/incorrect|damaged/i);
    const reset = await resetVaultPasswordWithRecovery(rotated, rotatedRecoveryKey, 'new vault password');
    expect(reset.key.equals(key)).toBe(true);
    expect((await unlockVault(reset.config, 'new vault password')).equals(key)).toBe(true);
    await expect(unlockVault(reset.config, 'old vault password')).rejects.toThrow(/Incorrect vault password/);
    const revoked = rotateVaultRecoveryKey(reset.config, reset.key, null);
    expect(() => unlockVaultWithRecovery(revoked, rotatedRecoveryKey)).toThrow(/not configured/);
    for (const item of [legacyKey, key, recovered, reset.key]) item.fill(0);
  });

  it('rejects malformed and tampered recovery envelopes', async () => {
    const { config, key } = await createVaultSecurityConfig('correct horse battery');
    const recoveryKey = generateVaultRecoveryKey();
    const { config: configured, key: dataKey } = await prepareVaultRecovery(
      config,
      'correct horse battery',
      recoveryKey,
      null,
    );
    expect(() => unlockVaultWithRecovery(configured, 'not-a-recovery-key')).toThrow(/invalid/i);
    expect(() => unlockVaultWithRecovery(configured, recoveryKey.slice(0, -1))).toThrow(/invalid/i);
    expect(() =>
      unlockVaultWithRecovery(
        { ...configured, recoveryWrappedDataKey: `${configured.recoveryWrappedDataKey}A` },
        recoveryKey,
      ),
    ).toThrow(/invalid/i);
    key.fill(0);
    dataKey.fill(0);
  });

  it('authenticates, rotates, revokes, and resets version-2 vaults with recovery material', async () => {
    const { config: passwordConfig, key } = await createVaultSecurityConfig('old vault password');
    expect(passwordConfig.version).toBe(2);
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

  it('rejects malformed and tampered version-2 recovery envelopes', async () => {
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

  it('migrates a legacy vault key and credentials atomically into a recoverable key envelope', async () => {
    const legacy = await createVaultSecurityConfig('correct horse battery');
    const recoveryKey = generateVaultRecoveryKey();
    const credentials = JSON.stringify([{ id: 'service', username: 'user', password: 'credential secret' }]);
    const migrated = await prepareVaultRecovery(legacy.config, 'correct horse battery', recoveryKey, credentials);
    expect(migrated.config.version).toBe(3);
    expect(migrated.config.credentials).not.toBeNull();
    expect(decryptRecord(migrated.key, 'credentials', migrated.config.credentials)).toBe(credentials);
    expect(unwrapLegacyVaultKey(migrated.config, migrated.key)?.equals(legacy.key)).toBe(true);
    await expect(unlockVault({ ...migrated.config, credentials: null }, 'correct horse battery')).rejects.toThrow(
      /damaged security metadata/,
    );
    const ciphertext = migrated.config.credentials!.ciphertext;
    expect(() =>
      decryptRecord(migrated.key, 'credentials', {
        ...migrated.config.credentials!,
        ciphertext: `${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`,
      }),
    ).toThrow();
    await expect(
      unlockVault(
        { ...migrated.config, recoveryKey: 'must not be persisted' } as typeof migrated.config,
        'correct horse battery',
      ),
    ).rejects.toThrow(/security metadata is invalid/);
    expect(() =>
      unlockVaultWithRecovery(
        { ...migrated.config, recoveryWrappedDataKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
        recoveryKey,
      ),
    ).toThrow(/recovery data is damaged/i);
    const recovered = await unlockVaultWithRecovery(migrated.config, recoveryKey);
    expect(recovered.equals(migrated.key)).toBe(true);
    expect(() => unlockVaultWithRecovery(migrated.config, generateVaultRecoveryKey())).toThrow(/Recovery key/);
    expect(() => unlockVaultWithRecovery(migrated.config, 'malformed')).toThrow(/Recovery key/);
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
    expect(() => unlockVaultWithRecovery(rotated, oldRecoveryKey)).toThrow(/Recovery key/);
    expect((await unlockVaultWithRecovery(rotated, newRecoveryKey)).equals(reset.key)).toBe(true);
    const revoked = rotateVaultRecoveryKey(rotated, reset.key, null);
    expect(() => unlockVaultWithRecovery(revoked, newRecoveryKey)).toThrow(/not configured/);
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
