import { describe, expect, it, vi } from 'vitest';
import { saveRecording } from './save-recording';

describe('saveRecording', () => {
  it('sends the blob bytes with a timestamped audio file name', async () => {
    const saveAudioRecording = vi.fn<
      (notebookPath: string, fileName: string, data: ArrayBuffer) => Promise<{ path: string; vault: unknown }>
    >(async () => ({ path: 'Work/Audio note 20261105T100000Z.webm', vault: {} }));
    const blob = new Blob(['hello'], { type: 'audio/webm' });
    const path = await saveRecording(
      { saveAudioRecording },
      'Work',
      { blob, extension: '.webm', mimeType: 'audio/webm' },
      new Date('2026-11-05T10:00:00.000Z'),
    );
    expect(path).toBe('Work/Audio note 20261105T100000Z.webm');
    expect(saveAudioRecording).toHaveBeenCalledTimes(1);
    const [notebookPath, fileName, data] = saveAudioRecording.mock.calls[0];
    expect(notebookPath).toBe('Work');
    expect(fileName).toBe('Audio note 20261105T100000Z.webm');
    expect(new Uint8Array(data)).toEqual(new Uint8Array([104, 101, 108, 108, 111]));
  });

  it('reports clearly when the bridge cannot save recordings', async () => {
    await expect(
      saveRecording(
        {},
        'Work',
        { blob: new Blob(['x']), extension: '.webm', mimeType: 'audio/webm' },
      ),
    ).rejects.toThrow('Saving audio recordings is unavailable');
  });
});
