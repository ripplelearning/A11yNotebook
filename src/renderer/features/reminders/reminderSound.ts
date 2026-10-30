import type { NotebookSettings } from '../../../shared/settings';

let playing: HTMLAudioElement | null = null;

export function stopReminderSound() {
  playing?.pause();
  playing = null;
}

export async function playReminderSound(settings: NotebookSettings) {
  stopReminderSound();
  let source: string;
  if (settings.reminderSoundChoice === 'custom' && settings.reminderSoundFile) {
    const read = window.a11yNotebook?.vault.readReminderSoundFile;
    if (!read) throw new Error('Custom reminder sounds are unavailable.');
    // Read through the main process so the renderer never needs direct
    // file access; a missing or moved file surfaces as a playback error
    // instead of silently falling back to a different sound.
    source = await read(settings.reminderSoundFile);
  } else {
    source = new URL('../../../assets/reminder-gentle-chime.wav', import.meta.url).href;
  }
  const audio = new Audio(source);
  audio.volume = (settings.reminderVolume ?? 50) / 100;
  playing = audio;
  await audio.play();
}
