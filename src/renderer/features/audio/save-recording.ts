import { recordingFileName } from '../../../shared/audio';
import type { FinishedRecording } from './recorder';

export interface AudioSavingBridge {
  saveAudioRecording?: (
    notebookPath: string,
    fileName: string,
    data: ArrayBuffer,
  ) => Promise<{ path: string; vault: unknown }>;
}

/**
 * Blob bytes as an ArrayBuffer. Modern browsers and Electron offer
 * Blob.arrayBuffer directly; the FileReader fallback covers older
 * environments (and jsdom, whose Blob lacks arrayBuffer).
 */
async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Could not read the recording.'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Save a finished recording into a notebook folder through the
 * main-process bridge. Returns the saved vault path. The file name
 * is timestamped so two recordings in one notebook never collide;
 * the main process still de-duplicates if one does.
 */
export async function saveRecording(
  bridge: AudioSavingBridge,
  notebookPath: string,
  recording: FinishedRecording,
  now: Date = new Date(),
): Promise<string> {
  if (!bridge.saveAudioRecording) {
    throw new Error('Saving audio recordings is unavailable in this version of the app.');
  }
  const data = await blobToArrayBuffer(recording.blob);
  const fileName = recordingFileName(now, recording.extension);
  const saved = await bridge.saveAudioRecording(notebookPath, fileName, data);
  return saved.path;
}
