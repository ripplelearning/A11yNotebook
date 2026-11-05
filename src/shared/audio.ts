/**
 * Audio notes, dictation, and transcription helpers.
 *
 * Audio files live in the library like any other file: a recording
 * or an imported audio file sits in a notebook folder, and its
 * transcript (when one exists) is a Markdown note in the same
 * folder that links back to the audio file. Nothing here touches
 * the filesystem; saving goes through the main-process bridge,
 * the same way notes do.
 */

/** Audio formats the app can import and play back. */
export const AUDIO_EXTENSIONS = ['.webm', '.mp3', '.wav', '.m4a', '.ogg', '.flac'] as const;

export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];

export function isAudioPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** MIME type for an audio file path, or '' when the extension is not a known audio type. */
export function audioMimeType(filePath: string): string {
  switch (filePath.slice(filePath.lastIndexOf('.')).toLowerCase()) {
    case '.webm':
      return 'audio/webm';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
      return 'audio/mp4';
    case '.ogg':
      return 'audio/ogg';
    case '.flac':
      return 'audio/flac';
    default:
      return '';
  }
}

/** MIME types MediaRecorder is tried with, best first. */
export const RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const;

/**
 * Pick the first recording MIME type the browser claims to support.
 * Returns '' when none is supported, which tells MediaRecorder to
 * use its default instead of failing on an unsupported type.
 */
export function pickRecordingMimeType(isTypeSupported: (mimeType: string) => boolean): string {
  for (const mimeType of RECORDING_MIME_TYPES) {
    try {
      if (isTypeSupported(mimeType)) return mimeType;
    } catch {
      // A throwing probe counts as unsupported; keep trying.
    }
  }
  return '';
}

/** File extension (with dot) for a recording saved from a MIME type. */
export function recordingExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return '.m4a';
  if (mimeType.includes('ogg')) return '.ogg';
  return '.webm';
}

function splitPath(filePath: string): { directory: string; stem: string; extension: string } {
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const directory = slash >= 0 ? filePath.slice(0, slash) : '';
  const name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { directory, stem: name, extension: '' };
  return { directory, stem: name.slice(0, dot), extension: name.slice(dot) };
}

function joinPath(directory: string, name: string): string {
  return directory ? `${directory}/${name}` : name;
}

/** Transcript note path for an audio file in the same folder. */
export function transcriptPathForAudio(audioPath: string): string {
  const { directory, stem } = splitPath(audioPath);
  return joinPath(directory, `${stem} transcript.md`);
}

/**
 * Stem path (folder plus file name, without extension) of the audio
 * file a transcript note belongs to, or null when the note is not a
 * transcript. The extension is not recoverable from the note name
 * alone, so callers match the stem against the audio extensions.
 */
export function audioStemForTranscript(notePath: string): string | null {
  const { directory, stem, extension } = splitPath(notePath);
  if (extension.toLowerCase() !== '.md') return null;
  const suffix = ' transcript';
  if (!stem.endsWith(suffix)) return null;
  return joinPath(directory, stem.slice(0, -suffix.length));
}

/** Whether a note path is a transcript note (by name, not by content). */
export function isTranscriptNote(notePath: string): boolean {
  return audioStemForTranscript(notePath) !== null;
}

/** File name for a new recording inside a notebook folder. */
export function recordingFileName(recordedAt: Date, extension: string): string {
  const stamp = recordedAt
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  return `Audio note ${stamp}${extension}`;
}

/**
 * Contents of a transcript note: a heading, a link back to the audio
 * file in the same folder, then the transcribed text. The link is
 * relative so moving the notebook retargets it like any other link.
 */
export function transcriptNoteContent(audioFileName: string, transcript: string): string {
  return `# Transcript of ${audioFileName}\n\n[Audio: ${audioFileName}](./${audioFileName})\n\n${transcript}\n`;
}

/**
 * Transcription model choice. The user picks one in an accessible
 * dialog the first time transcription is used; the choice is not
 * fixed by the app. Sizes are the one-time download sizes for the
 * model files (verified November 4, 2026 against the published
 * Whisper model sizes: tiny about 75 MB, base about 150 MB, small
 * about 500 MB, large about 1.5 GB). Either model runs locally
 * after downloading, so audio never leaves the machine.
 */
export interface TranscriptionModelOption {
  id: 'smaller' | 'larger';
  modelId: string;
  label: string;
  size: string;
  summary: string;
}

export const TRANSCRIPTION_MODELS: TranscriptionModelOption[] = [
  {
    id: 'smaller',
    modelId: 'onnx-community/whisper-base',
    label: 'Smaller model',
    size: 'About 150 MB',
    summary:
      'Faster to download and faster to transcribe. Good accuracy for clear speech.',
  },
  {
    id: 'larger',
    modelId: 'onnx-community/whisper-small',
    label: 'Larger model',
    size: 'About 500 MB',
    summary:
      'Slower to download and slower to transcribe. Noticeably more accurate, especially with accents, background noise, or quiet speech.',
  },
];

/** The dialog preselects the smaller model. */
export const DEFAULT_TRANSCRIPTION_MODEL_ID: TranscriptionModelOption['id'] = 'smaller';

export type TranscriptionStatus =
  | 'idle'
  | 'downloading'
  | 'ready'
  | 'transcribing'
  | 'error';

/** Human-readable status line for the transcription state. */
export function transcriptionStatusText(status: TranscriptionStatus): string {
  switch (status) {
    case 'downloading':
      return 'Downloading the transcription model. This happens once.';
    case 'ready':
      return 'Transcription model ready.';
    case 'transcribing':
      return 'Transcribing. This runs on your machine.';
    case 'error':
      return 'Transcription is unavailable. Recordings and playback still work.';
    case 'idle':
    default:
      return 'Transcription model not downloaded yet.';
  }
}
