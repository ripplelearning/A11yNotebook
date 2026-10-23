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
  completeVaultDataKeyRotation,
  generateVaultRecoveryKey,
  prepareVaultRecovery,
  rotateVaultDataKey,
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
  // Multi-KDF recovery lifecycles retain real scrypt and use the integration recovery budget.
  it('derives a vault key and authenticates the password', async () => {
    const { config, key } = await createVaultSecurityConfig('correct horse battery');
    const unlocked = await unlockVault(config, 'correct horse battery');
    expect(unlocked.equals(key)).toBe(true);
    key.fill(0);
    unlocked.fill(0);
    await expect(unlockVault(config, 'incorrect password')).rejects.toThrow(/Incorrect library password/);
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
  }, 30_000);

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
    await expect(unlockVault(reset.config, 'old vault password')).rejects.toThrow(/Incorrect library password/);
    const revoked = rotateVaultRecoveryKey(reset.config, reset.key, null);
    expect(() => unlockVaultWithRecovery(revoked, rotatedRecoveryKey)).toThrow(/not configured/);
    for (const item of [legacyKey, key, recovered, reset.key]) item.fill(0);
  }, 30_000);

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
    await expect(unlockVault(reset.config, 'old vault password')).rejects.toThrow(/Incorrect library password/);
    const revoked = revokeVaultRecoveryKey(reset.config);
    expect(() => unlockVaultWithRecovery(revoked, rotated.recoveryKey)).toThrow(/not configured/);
    for (const item of [key, recovered, reset.key]) item.fill(0);
  }, 30_000);

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
  }, 30_000);

  it('resets the password and supports recovery-key rotation and revocation', async () => {
    const legacy = await createVaultSecurityConfig('correct horse battery');
    const oldRecoveryKey = generateVaultRecoveryKey();
    const migrated = await prepareVaultRecovery(legacy.config, 'correct horse battery', oldRecoveryKey, null);
    const reset = await resetVaultPasswordWithRecovery(migrated.config, oldRecoveryKey, 'new vault password');
    await expect(unlockVault(reset.config, 'correct horse battery')).rejects.toThrow(/Incorrect library password/);
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
  }, 30_000);

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

  it('rotates the data key: both factors unwrap the new key, the old key survives only as legacy', async () => {
    const password = 'correct horse battery';
    const recoveryKey = generateVaultRecoveryKey();
    const legacy = await createVaultSecurityConfig(password);
    const prepared = await prepareVaultRecovery(legacy.config, password, recoveryKey, null);
    legacy.key.fill(0);
    const note = encryptRecord(prepared.key, 'note', 'note-1', 'private note text');
    const { config: rotated, oldKey, newKey } = await rotateVaultDataKey(prepared.config, password, recoveryKey);
    try {
      expect(oldKey.equals(prepared.key)).toBe(true);
      expect(newKey.equals(oldKey)).toBe(false);
      const byPassword = await unlockVault(rotated, password);
      expect(byPassword.equals(newKey)).toBe(true);
      byPassword.fill(0);
      const byRecovery = unlockVaultWithRecovery(rotated, recoveryKey);
      expect(byRecovery.equals(newKey)).toBe(true);
      byRecovery.fill(0);
      // New content encrypts under the new key; old content opens via legacy.
      expect(() => decryptRecord(oldKey, 'note', note)).not.toThrow();
      const legacyKey = unwrapLegacyVaultKey(rotated, newKey);
      expect(legacyKey?.equals(oldKey)).toBe(true);
      expect(decryptRecord(legacyKey!, 'note', note)).toBe('private note text');
      legacyKey?.fill(0);
      expect(() => decryptRecord(newKey, 'note', note)).toThrow();
      // Wrong recovery key and wrong password are both refused.
      await expect(rotateVaultDataKey(prepared.config, password, generateVaultRecoveryKey())).rejects.toThrow();
      await expect(rotateVaultDataKey(prepared.config, 'wrong password here', recoveryKey)).rejects.toThrow();
      // Completion drops the old key: legacy becomes a self-wrap.
      const completed = completeVaultDataKeyRotation(rotated, newKey);
      const completedLegacy = unwrapLegacyVaultKey(completed, newKey);
      expect(completedLegacy?.equals(newKey)).toBe(true);
      completedLegacy?.fill(0);
      const reopened = await unlockVault(completed, password);
      expect(reopened.equals(newKey)).toBe(true);
      reopened.fill(0);
    } finally {
      oldKey.fill(0);
      newKey.fill(0);
      prepared.key.fill(0);
    }
  }, 30_000);

  it('rotates the data key when recovery is revoked, keeping recovery off', async () => {
    const password = 'correct horse battery';
    const legacy = await createVaultSecurityConfig(password);
    const prepared = await prepareVaultRecovery(legacy.config, password, generateVaultRecoveryKey(), null);
    legacy.key.fill(0);
    const revoked = rotateVaultRecoveryKey(prepared.config, prepared.key, null);
    const { config: rotated, newKey } = await rotateVaultDataKey(revoked, password, null);
    try {
      expect(rotated.recoveryWrappedDataKey).toBeNull();
      const byPassword = await unlockVault(rotated, password);
      expect(byPassword.equals(newKey)).toBe(true);
      byPassword.fill(0);
    } finally {
      newKey.fill(0);
      prepared.key.fill(0);
    }
  }, 30_000);

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
