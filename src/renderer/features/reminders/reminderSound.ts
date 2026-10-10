import type { NotebookSettings } from '../../../shared/settings';

let playing: HTMLAudioElement | null = null;

export function stopReminderSound() {
  playing?.pause();
  playing = null;
}

export async function playReminderSound(settings: NotebookSettings) {
  stopReminderSound();
  const audio = new Audio(new URL('../../../assets/reminder-gentle-chime.wav', import.meta.url).href);
  audio.volume = (settings.reminderVolume ?? 50) / 100;
  playing = audio;
  await audio.play();
}
