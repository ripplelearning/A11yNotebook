/**
 * Local transcription with Whisper, via @huggingface/transformers.
 *
 * The model runs entirely on this machine: the model files download
 * once from Hugging Face Hub, are cached by the library, and audio
 * is never sent anywhere. The pipeline is loaded lazily (dynamic
 * import) so the app starts without it, and the factory and audio
 * decoder are injectable so tests never download a model or open a
 * microphone.
 *
 * Whisper expects 16 kHz mono PCM. The decoder resamples the
 * recording to 16 kHz before handing it to the pipeline.
 */
import { TRANSCRIPTION_MODELS, type TranscriptionModelOption } from '../../../shared/audio';

export type TranscriptionEngineStatus = 'idle' | 'downloading' | 'ready' | 'transcribing' | 'error';

export interface Transcriber {
  (audio: Float32Array): Promise<{ text: string }>;
}

export interface PipelineOptions {
  device?: 'webgpu' | 'wasm';
  dtype?: 'fp32' | 'q8';
  progress_callback?: (data: {
    status: string;
    file?: string;
    progress?: number;
  }) => void;
}

export interface TranscriptionDeps {
  createPipeline: (
    task: 'automatic-speech-recognition',
    model: string,
    options: PipelineOptions,
  ) => Promise<Transcriber>;
  decodeAudio: (blob: Blob) => Promise<Float32Array>;
}

export const WHISPER_SAMPLE_RATE = 16000;

/** Default decoder: decode with AudioContext, resample to 16 kHz mono. */
export async function decodeAudioTo16k(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await context.decodeAudioData(arrayBuffer);
    if (decoded.sampleRate === WHISPER_SAMPLE_RATE && decoded.numberOfChannels === 1) {
      return decoded.getChannelData(0).slice();
    }
    const offline = new OfflineAudioContext(
      1,
      Math.ceil((decoded.duration * WHISPER_SAMPLE_RATE) / 1),
      WHISPER_SAMPLE_RATE,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Default factory: the real transformers.js pipeline, loaded lazily. */
export async function createRealPipeline(
  task: 'automatic-speech-recognition',
  model: string,
  options: PipelineOptions,
): Promise<Transcriber> {
  const { pipeline } = await import('@huggingface/transformers');
  return pipeline(task, model, options) as Promise<Transcriber>;
}

export class LocalTranscriber {
  status: TranscriptionEngineStatus = 'idle';
  loadedModelId: string | null = null;
  private transcriber: Transcriber | null = null;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly deps: TranscriptionDeps = {
      createPipeline: createRealPipeline,
      decodeAudio: decodeAudioTo16k,
    },
  ) {}

  /** Download (once) and load the chosen model. Safe to call repeatedly. */
  async ensureModel(
    optionId: TranscriptionModelOption['id'],
    onProgress?: (fraction: number) => void,
  ): Promise<void> {
    const option = TRANSCRIPTION_MODELS.find((candidate) => candidate.id === optionId);
    if (!option) throw new Error('Choose a transcription model first.');
    if (this.loadedModelId === option.modelId && this.transcriber) return;
    if (this.loading) return this.loading;
    this.status = 'downloading';
    this.loading = this.load(option, onProgress)
      .then(() => {
        this.status = 'ready';
      })
      .catch((error: unknown) => {
        this.status = 'error';
        this.transcriber = null;
        this.loadedModelId = null;
        throw error instanceof Error
          ? error
          : new Error('The transcription model could not be downloaded.');
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  private async load(
    option: TranscriptionModelOption,
    onProgress?: (fraction: number) => void,
  ): Promise<void> {
    const progress_callback = (data: { status: string; progress?: number }) => {
      if (data.status === 'progress' && typeof data.progress === 'number') {
        onProgress?.(Math.max(0, Math.min(1, data.progress / 100)));
      }
      if (data.status === 'done') onProgress?.(1);
    };
    try {
      // Full-precision weights on WebGPU: the reliable path, and the
      // download sizes the choice dialog quotes (about 150 / 500 MB).
      this.transcriber = await this.deps.createPipeline('automatic-speech-recognition', option.modelId, {
        device: 'webgpu',
        dtype: 'fp32',
        progress_callback,
      });
    } catch {
      // Machines without WebGPU fall back to quantized weights on WASM.
      // That download is smaller than the quoted size, never larger.
      this.transcriber = await this.deps.createPipeline('automatic-speech-recognition', option.modelId, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback,
      });
    }
    this.loadedModelId = option.modelId;
  }

  /** Transcribe one audio Blob into text with the chosen model. */
  async transcribe(
    blob: Blob,
    optionId: TranscriptionModelOption['id'],
  ): Promise<string> {
    await this.ensureModel(optionId);
    if (!this.transcriber) throw new Error('The transcription model is not loaded.');
    this.status = 'transcribing';
    try {
      const audio = await this.deps.decodeAudio(blob);
      const result = await this.transcriber(audio);
      this.status = 'ready';
      return result.text.trim();
    } catch (error) {
      this.status = 'error';
      throw error instanceof Error ? error : new Error('Transcription failed.');
    }
  }
}
