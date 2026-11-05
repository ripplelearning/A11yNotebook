/**
 * Microphone recording for audio notes and dictation.
 *
 * The browser's MediaRecorder is wrapped in a small state machine
 * so the UI can announce recording, stopping, and failure in plain
 * language, and so tests can drive it with a fake recorder instead
 * of a real microphone. The recorded Blob is handed to the caller,
 * which saves it through the main-process bridge; this module never
 * touches the filesystem.
 */
import { pickRecordingMimeType, recordingExtension } from '../../../shared/audio';

export type RecorderStatus = 'idle' | 'recording' | 'stopped' | 'error';

export interface RecorderStream {
  getTracks(): { stop(): void }[];
}

export interface RecorderLike {
  readonly mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: { error?: { message?: string } }) => void) | null;
  start(): void;
  stop(): void;
}

export interface RecorderDeps {
  getUserMedia(constraints: { audio: boolean }): Promise<RecorderStream>;
  createRecorder(
    stream: RecorderStream,
    options: { mimeType: string },
  ): RecorderLike;
  isTypeSupported(mimeType: string): boolean;
}

export interface FinishedRecording {
  blob: Blob;
  extension: string;
  mimeType: string;
}

/**
 * Record one segment. Call start() once, then stop(); the finished
 * Blob arrives through onFinished. A failed start (no microphone,
 * permission denied, unsupported browser) reports through onError
 * with the browser's message kept for the status line.
 */
export class AudioRecorder {
  private recorder: RecorderLike | null = null;
  private stream: RecorderStream | null = null;
  private chunks: Blob[] = [];
  private mimeType = '';
  status: RecorderStatus = 'idle';

  constructor(
    private readonly deps: RecorderDeps,
    private readonly onFinished: (recording: FinishedRecording) => void,
    private readonly onError: (message: string) => void,
  ) {}

  async start(): Promise<void> {
    if (this.status === 'recording') return;
    this.chunks = [];
    let stream: RecorderStream;
    try {
      stream = await this.deps.getUserMedia({ audio: true });
    } catch (error) {
      this.status = 'error';
      this.onError(error instanceof Error ? error.message : 'Microphone is unavailable.');
      return;
    }
    this.stream = stream;
    this.mimeType = pickRecordingMimeType(this.deps.isTypeSupported);
    const recorder = this.deps.createRecorder(stream, { mimeType: this.mimeType });
    this.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onstop = () => {
      this.stopTracks();
      this.status = 'stopped';
      this.onFinished({
        blob: new Blob(this.chunks, { type: this.mimeType || undefined }),
        extension: recordingExtension(this.mimeType),
        mimeType: this.mimeType,
      });
    };
    recorder.onerror = (event) => {
      this.stopTracks();
      this.status = 'error';
      this.onError(event.error?.message ?? 'Recording failed.');
    };
    try {
      recorder.start();
      this.status = 'recording';
    } catch (error) {
      this.stopTracks();
      this.status = 'error';
      this.onError(error instanceof Error ? error.message : 'Recording could not start.');
    }
  }

  stop(): void {
    if (this.status !== 'recording' || !this.recorder) return;
    try {
      this.recorder.stop();
    } catch {
      this.stopTracks();
      this.status = 'error';
      this.onError('Recording could not stop.');
    }
  }

  private stopTracks(): void {
    for (const track of this.stream?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        // A track that is already stopped is fine to ignore.
      }
    }
    this.stream = null;
  }
}
