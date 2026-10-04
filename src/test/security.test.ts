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
