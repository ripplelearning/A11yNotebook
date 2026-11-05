import { describe, expect, it, vi } from 'vitest';
import { LocalTranscriber, type Transcriber, type TranscriptionDeps } from './transcription';

function makeEngine(deps: Partial<TranscriptionDeps> = {}) {
  const createPipeline = vi.fn<TranscriptionDeps['createPipeline']>(
    async () => async () => ({ text: '  Hello world.  ' }),
  );
  const decodeAudio = vi.fn(async () => new Float32Array([0.1, 0.2, 0.3]));
  const engine = new LocalTranscriber({
    createPipeline,
    decodeAudio,
    ...deps,
  });
  return { engine, createPipeline, decodeAudio };
}

describe('LocalTranscriber', () => {
  it('loads the smaller model on WebGPU and reports progress', async () => {
    const { engine, createPipeline } = makeEngine();
    const progress = vi.fn();
    await engine.ensureModel('smaller', progress);
    expect(engine.status).toBe('ready');
    expect(engine.loadedModelId).toBe('onnx-community/whisper-base');
    expect(createPipeline).toHaveBeenCalledTimes(1);
    expect(createPipeline.mock.calls[0][1]).toBe('onnx-community/whisper-base');
    expect(createPipeline.mock.calls[0][2].device).toBe('webgpu');
  });

  it('loads the larger model when asked', async () => {
    const { engine } = makeEngine();
    await engine.ensureModel('larger');
    expect(engine.loadedModelId).toBe('onnx-community/whisper-small');
  });

  it('does not reload a model that is already loaded', async () => {
    const { engine, createPipeline } = makeEngine();
    await engine.ensureModel('smaller');
    await engine.ensureModel('smaller');
    expect(createPipeline).toHaveBeenCalledTimes(1);
  });

  it('falls back to WASM when WebGPU is unavailable', async () => {
    const createPipeline = vi.fn<TranscriptionDeps['createPipeline']>(
      async (_task, _model, options) => {
        if (options.device === 'webgpu') throw new Error('WebGPU is not available.');
        const transcribe: Transcriber = async () => ({ text: 'hi' });
        return transcribe;
      },
    );
    const { engine } = makeEngine({ createPipeline });
    await engine.ensureModel('smaller');
    expect(engine.status).toBe('ready');
    expect(createPipeline).toHaveBeenCalledTimes(2);
    expect(createPipeline.mock.calls[1][2].device).toBe('wasm');
  });

  it('transcribes audio and trims the result', async () => {
    const { engine, decodeAudio, createPipeline } = makeEngine();
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const text = await engine.transcribe(blob, 'smaller');
    expect(text).toBe('Hello world.');
    expect(decodeAudio).toHaveBeenCalledWith(blob);
    expect(createPipeline).toHaveBeenCalledTimes(1);
    expect(engine.status).toBe('ready');
  });

  it('reports an error when transcription fails', async () => {
    const { engine } = makeEngine({
      createPipeline: async () => async () => {
        throw new Error('Inference failed.');
      },
    });
    await expect(engine.transcribe(new Blob(['x']), 'smaller')).rejects.toThrow('Inference failed.');
    expect(engine.status).toBe('error');
  });
});
