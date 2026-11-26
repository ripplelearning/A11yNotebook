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
  /** Pause capture without ending the recording; resume() picks it back up. */
  pause(): void;
  /** Resume capture after pause(). */
  resume(): void;
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
 * Read a thrown value's message and name by shape. getUserMedia
 * rejects with a DOMException, which is not an Error in every
 * environment (jsdom included), so `instanceof Error` alone would
 * drop both fields and every denial would look like a generic
 * "Microphone is unavailable."
 */
function thrownErrorDetails(error: unknown, fallbackMessage: string): { message: string; name?: string } {
  if (typeof error === 'object' && error !== null) {
    const maybe = error as { message?: unknown; name?: unknown };
    if (typeof maybe.message === 'string') {
      return {
        message: maybe.message,
        name: typeof maybe.name === 'string' ? maybe.name : undefined,
      };
    }
  }
  return { message: fallbackMessage };
}

/**
 * Record one segment. Call start() once, then stop(); the finished
 * Blob arrives through onFinished. A failed start (no microphone,
 * permission denied, unsupported browser) reports through onError
 * with the browser's message kept for the status line and the error
 * name (for example 'NotAllowedError') so the caller can tell a
 * blocked microphone from any other failure.
 *
 * pause() mutes the microphone without ending the session: while
 * paused no audio is captured, and resume() picks the same recording
 * back up. The finished Blob covers only the unmuted parts — the
 * paused gap leaves no silence in it — so transcription just reads
 * what was actually spoken. stop({ discardFinishedRecording: true })
 * ends the recording without delivering it, for sessions that ended
 * somewhere the recording no longer belongs (the note was closed, or
 * the user left it); the microphone is still released.
 */
export class AudioRecorder {
  private recorder: RecorderLike | null = null;
  private stream: RecorderStream | null = null;
  private chunks: Blob[] = [];
  private mimeType = '';
  private discardOnFinish = false;
  status: RecorderStatus = 'idle';
  /** True while the microphone is muted with pause() during a recording. */
  paused = false;

  constructor(
    private readonly deps: RecorderDeps,
    private readonly onFinished: (recording: FinishedRecording) => void,
    private readonly onError: (message: string, name?: string) => void,
  ) {}

  async start(): Promise<void> {
    if (this.status === 'recording') return;
    this.chunks = [];
    this.paused = false;
    this.discardOnFinish = false;
    let stream: RecorderStream;
    try {
      stream = await this.deps.getUserMedia({ audio: true });
    } catch (error) {
      this.status = 'error';
      const details = thrownErrorDetails(error, 'Microphone is unavailable.');
      this.onError(details.message, details.name);
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
      this.paused = false;
      if (this.discardOnFinish) {
        this.discardOnFinish = false;
        return;
      }
      this.onFinished({
        blob: new Blob(this.chunks, { type: this.mimeType || undefined }),
        extension: recordingExtension(this.mimeType),
        mimeType: this.mimeType,
      });
    };
    recorder.onerror = (event) => {
      this.stopTracks();
      this.status = 'error';
      this.paused = false;
      this.onError(event.error?.message ?? 'Recording failed.');
    };
    try {
      recorder.start();
      this.status = 'recording';
    } catch (error) {
      this.stopTracks();
      this.status = 'error';
      const details = thrownErrorDetails(error, 'Recording could not start.');
      this.onError(details.message, details.name);
    }
  }

  stop(options?: { discardFinishedRecording?: boolean }): void {
    if (this.status !== 'recording' || !this.recorder) return;
    this.discardOnFinish = options?.discardFinishedRecording ?? false;
    try {
      this.recorder.stop();
    } catch {
      this.stopTracks();
      this.status = 'error';
      this.paused = false;
      this.onError('Recording could not stop.');
    }
  }

  /**
   * Mute the microphone without ending the session. Returns false
   * when there is nothing recording to mute, so the caller can leave
   * the announced state alone instead of claiming a change.
   */
  pause(): boolean {
    if (this.status !== 'recording' || this.paused || !this.recorder) return false;
    try {
      this.recorder.pause();
    } catch {
      return false;
    }
    this.paused = true;
    return true;
  }

  /**
   * Turn the microphone back on after pause(). Returns false when
   * there is nothing muted to resume.
   */
  resume(): boolean {
    if (this.status !== 'recording' || !this.paused || !this.recorder) return false;
    try {
      this.recorder.resume();
    } catch {
      return false;
    }
    this.paused = false;
    return true;
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
