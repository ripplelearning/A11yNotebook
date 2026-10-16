import { describe, expect, it } from 'vitest';
import { INVOKE_CHANNELS, IPC_CHANNELS } from '../shared/ipc';

describe('shared IPC contract', () => {
  it('registers each channel once while retaining both creation and import workflows', () => {
    const channels = Object.values(IPC_CHANNELS);
    expect(new Set(channels).size).toBe(channels.length);
    expect(new Set(INVOKE_CHANNELS).size).toBe(INVOKE_CHANNELS.length);
    expect(INVOKE_CHANNELS).toEqual(
      expect.arrayContaining([
        IPC_CHANNELS.vaultCreateLibrary,
        IPC_CHANNELS.vaultCreateTask,
        IPC_CHANNELS.vaultImportEntry,
        IPC_CHANNELS.vaultImportAsNote,
        IPC_CHANNELS.vaultAdoptEncrypted,
        IPC_CHANNELS.vaultOpenWith,
      ]),
    );
  });
});
