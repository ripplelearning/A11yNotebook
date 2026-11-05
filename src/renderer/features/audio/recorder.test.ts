import { describe, expect, it, vi } from 'vitest';
import { AudioRecorder, type RecorderLike, type RecorderStream } from './recorder';

class FakeRecorder implements RecorderLike {
  readonly mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: { error?: { message?: string } }) => void) | null = null;
  started = false;
  stopped = false;

  constructor(mimeType: string) {
    this.mimeType = mimeType;
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
    this.ondataavailable?.({ data: new Blob(['hello'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

function makeRecorder() {
  let fake: FakeRecorder | null = null;
  const tracks = [{ stop: vi.fn() }];
  const stream: RecorderStream = { getTracks: () => tracks };
  const finished = vi.fn();
  const failed = vi.fn();
  const recorder = new AudioRecorder(
    {
      getUserMedia: async () => stream,
      createRecorder: (_stream, options) => {
        fake = new FakeRecorder(options.mimeType);
        return fake;
      },
      isTypeSupported: (mime) => mime === 'audio/webm;codecs=opus',
    },
    finished,
    failed,
  );
  return { recorder, finished, failed, tracks, getFake: () => fake };
}

describe('AudioRecorder', () => {
  it('records and delivers a blob with the picked mime type on stop', async () => {
    const { recorder, finished, tracks } = makeRecorder();
    await recorder.start();
    expect(recorder.status).toBe('recording');
    recorder.stop();
    expect(recorder.status).toBe('stopped');
    expect(finished).toHaveBeenCalledTimes(1);
    const recording = finished.mock.calls[0][0];
    expect(recording.extension).toBe('.webm');
    expect(recording.blob.size).toBeGreaterThan(0);
    expect(tracks[0].stop).toHaveBeenCalled();
  });

  it('ignores a second start while recording', async () => {
    const { recorder, getFake } = makeRecorder();
    await recorder.start();
    await recorder.start();
    expect(getFake()?.started).toBe(true);
    expect(recorder.status).toBe('recording');
  });

  it('reports a microphone failure without starting', async () => {
    const failed = vi.fn();
    const recorder = new AudioRecorder(
      {
        getUserMedia: async () => {
          throw new Error('Permission denied');
        },
        createRecorder: () => {
          throw new Error('unreachable');
        },
        isTypeSupported: () => true,
      },
      vi.fn(),
      failed,
    );
    await recorder.start();
    expect(recorder.status).toBe('error');
    expect(failed).toHaveBeenCalledWith('Permission denied');
  });

  it('reports a recorder error and stops the tracks', async () => {
    const { recorder, failed, tracks, getFake } = makeRecorder();
    await recorder.start();
    getFake()?.onerror?.({ error: { message: 'Device lost' } });
    expect(recorder.status).toBe('error');
    expect(failed).toHaveBeenCalledWith('Device lost');
    expect(tracks[0].stop).toHaveBeenCalled();
  });
});
