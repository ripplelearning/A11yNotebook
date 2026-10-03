// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createVaultSecurityConfig,
  decryptRecord,
  encryptRecord,
  isEncryptedRecord,
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
});
