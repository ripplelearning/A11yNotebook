import { safeStorage } from 'electron';
import type { GoogleAuthEncryptor } from './google-auth';

/** Production encryptor: Electron safeStorage (OS keychain / credential store). */
export const safeStorageEncryptor: GoogleAuthEncryptor = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plaintext) => safeStorage.encryptString(plaintext),
  decrypt: (ciphertext) => safeStorage.decryptString(ciphertext),
};
