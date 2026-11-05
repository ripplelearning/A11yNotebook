import { describe, expect, it } from 'vitest';
import {
  audioMimeType,
  audioStemForTranscript,
  isAudioPath,
  isTranscriptNote,
  pickRecordingMimeType,
  recordingExtension,
  recordingFileName,
  transcriptNoteContent,
  transcriptPathForAudio,
} from '../shared/audio';

describe('isAudioPath', () => {
  it('recognizes audio extensions case-insensitively', () => {
    expect(isAudioPath('Notes/Interview.MP3')).toBe(true);
    expect(isAudioPath('Notes/song.wav')).toBe(true);
    expect(isAudioPath('Notes/recording.webm')).toBe(true);
  });

  it('rejects notes, images, and documents', () => {
    expect(isAudioPath('Notes/Guide.md')).toBe(false);
    expect(isAudioPath('Notes/photo.png')).toBe(false);
    expect(isAudioPath('Notes/report.pdf')).toBe(false);
  });
});

describe('audioMimeType', () => {
  it('maps each audio extension to its MIME type', () => {
    expect(audioMimeType('Notes/a.webm')).toBe('audio/webm');
    expect(audioMimeType('Notes/a.MP3')).toBe('audio/mpeg');
    expect(audioMimeType('Notes/a.wav')).toBe('audio/wav');
    expect(audioMimeType('Notes/a.m4a')).toBe('audio/mp4');
    expect(audioMimeType('Notes/a.ogg')).toBe('audio/ogg');
    expect(audioMimeType('Notes/a.flac')).toBe('audio/flac');
    expect(audioMimeType('Notes/a.md')).toBe('');
  });
});

describe('pickRecordingMimeType', () => {
  it('returns the first supported type', () => {
    expect(pickRecordingMimeType((mime) => mime === 'audio/webm')).toBe('audio/webm');
  });

  it('returns empty when nothing is supported', () => {
    expect(pickRecordingMimeType(() => false)).toBe('');
  });

  it('treats a throwing probe as unsupported', () => {
    expect(
      pickRecordingMimeType((mime) => {
        if (mime === 'audio/webm;codecs=opus') throw new Error('probe failed');
        return mime === 'audio/webm';
      }),
    ).toBe('audio/webm');
  });
});

describe('recordingExtension', () => {
  it('maps mime types to file extensions', () => {
    expect(recordingExtension('audio/webm;codecs=opus')).toBe('.webm');
    expect(recordingExtension('audio/mp4')).toBe('.m4a');
    expect(recordingExtension('audio/ogg;codecs=opus')).toBe('.ogg');
    expect(recordingExtension('')).toBe('.webm');
  });
});

describe('transcript paths', () => {
  it('names the transcript note after its audio file', () => {
    expect(transcriptPathForAudio('Work/Interview.webm')).toBe('Work/Interview transcript.md');
    expect(transcriptPathForAudio('Interview.mp3')).toBe('Interview transcript.md');
  });

  it('recovers the audio stem from a transcript note', () => {
    expect(audioStemForTranscript('Work/Interview transcript.md')).toBe('Work/Interview');
    expect(audioStemForTranscript('Work/Guide.md')).toBeNull();
    expect(audioStemForTranscript('Work/Interview transcript.txt')).toBeNull();
  });

  it('detects transcript notes by name', () => {
    expect(isTranscriptNote('Work/Interview transcript.md')).toBe(true);
    expect(isTranscriptNote('Work/Interview.md')).toBe(false);
  });
});

describe('recordingFileName', () => {
  it('builds a timestamped name with the given extension', () => {
    expect(recordingFileName(new Date('2026-11-04T21:00:00.000Z'), '.webm')).toBe(
      'Audio note 20261104T210000Z.webm',
    );
  });
});

describe('transcriptNoteContent', () => {
  it('links back to the audio file and carries the text', () => {
    const content = transcriptNoteContent('Interview.webm', 'Hello world.');
    expect(content).toContain('# Transcript of Interview.webm');
    expect(content).toContain('[Audio: Interview.webm](./Interview.webm)');
    expect(content).toContain('Hello world.');
  });
});
