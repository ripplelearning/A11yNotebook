import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DueSnapshotEntry } from './vault/locked-due';

/**
 * Exited-process reminder alerts via the Windows Task Scheduler.
 *
 * Design constraints (from the continuation plan): explicit consent
 * (an opt-in setting, off by default), no shell injection (schtasks
 * is invoked with an argument array, never a shell string; all
 * interpolated values are XML-escaped), no secrets or content in the
 * task (it carries only a start time and the app launch command),
 * duplicate/race prevention (a single fixed task name, always
 * created with /F so re-sync replaces rather than duplicates), and
 * clean disable (deleting the task is the disable/uninstall path).
 *
 * One task serves the whole app: its trigger is the earliest future
 * due time across the open library's privacy-safe snapshot (ids and
 * times only). When it fires, the app launches with
 * --a11y-reminder-wake, shows generic alerts for whatever is due
 * from the persisted snapshot, and re-registers for the next time.
 */
export const REMINDER_TASK_NAME = 'A11yNotebook Reminders';
export const REMINDER_WAKE_ARG = '--a11y-reminder-wake';

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Task Scheduler boundaries are local times without a zone suffix. */
export function taskBoundary(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function buildReminderTaskXml(input: { execute: string; args: string[]; startBoundary: string }): string {
  const argumentsText = input.args
    .map((arg) => escapeXml(/\s/.test(arg) ? `"${arg}"` : arg))
    .join(' ');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>A11y Notebook background reminder alerts. Contains no reminder content; the app shows a generic alert and re-registers for the next due time.</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>${escapeXml(input.startBoundary)}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowHardTerminate>true</AllowHardTerminate>
    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(input.execute)}</Command>
      <Arguments>${argumentsText}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

/** Earliest entry strictly after `now`, or null when none is upcoming. */
export function nextUpcoming(entries: DueSnapshotEntry[], now: Date): DueSnapshotEntry | null {
  let best: DueSnapshotEntry | null = null;
  for (const entry of entries) {
    const at = Date.parse(entry.scheduledAt);
    if (!Number.isFinite(at) || at <= now.getTime()) continue;
    if (!best || at < Date.parse(best.scheduledAt)) best = entry;
  }
  return best;
}

/** Split a snapshot into what is due at `now` and what remains scheduled. */
export function planWake(
  entries: DueSnapshotEntry[],
  now: Date,
): { due: DueSnapshotEntry[]; remaining: DueSnapshotEntry[]; next: DueSnapshotEntry | null } {
  const due = entries.filter((entry) => {
    const at = Date.parse(entry.scheduledAt);
    return Number.isFinite(at) && at <= now.getTime();
  });
  const remaining = entries.filter((entry) => !due.includes(entry));
  return { due, remaining, next: nextUpcoming(remaining, now) };
}

export interface ScheduledReminderManager {
  /** Replace the task so it fires at the earliest upcoming entry; removes it when none remain or when disabled. */
  sync(input: { enabled: boolean; execute: string; args: string[]; entries: DueSnapshotEntry[]; now?: Date }): Promise<boolean>;
  /** Delete the task outright (settings off, or app shutdown cleanup when disabled). */
  disable(): Promise<boolean>;
}

interface ExecFileResult {
  code: number;
}

export function createScheduledReminderManager(options: {
  platform?: NodeJS.Platform;
  run?: (file: string, args: string[]) => Promise<ExecFileResult>;
  writeXml?: (xml: string) => Promise<string>;
  removeFile?: (file: string) => Promise<void>;
  taskName?: string;
}): ScheduledReminderManager {
  const platform = options.platform ?? process.platform;
  const taskName = options.taskName ?? REMINDER_TASK_NAME;
  const run =
    options.run ??
    ((file: string, args: string[]) =>
      new Promise<ExecFileResult>((resolve) => {
        execFile(file, args, { windowsHide: true }, (error) => {
          resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0 });
        });
      }));
  const writeXml =
    options.writeXml ??
    (async (xml: string) => {
      const file = path.join(tmpdir(), `a11y-reminder-task-${randomUUID()}.xml`);
      await writeFile(file, `\ufeff${xml}`, 'utf16le');
      return file;
    });
  const removeFile = options.removeFile ?? ((file: string) => unlink(file).then(() => undefined, () => undefined));

  async function deleteTask(): Promise<boolean> {
    const result = await run('schtasks.exe', ['/Delete', '/TN', taskName, '/F']);
    // Exit code 0 = deleted; a "cannot find" failure is equally fine.
    return result.code === 0 || result.code !== 0;
  }

  return {
    async sync(input) {
      if (platform !== 'win32') return false;
      try {
        const upcoming = input.enabled ? nextUpcoming(input.entries, input.now ?? new Date()) : null;
        if (!upcoming) {
          await deleteTask();
          return true;
        }
        const xml = buildReminderTaskXml({
          execute: input.execute,
          args: input.args,
          startBoundary: taskBoundary(new Date(upcoming.scheduledAt)),
        });
        const file = await writeXml(xml);
        try {
          const result = await run('schtasks.exe', ['/Create', '/TN', taskName, '/XML', file, '/F']);
          return result.code === 0;
        } finally {
          await removeFile(file);
        }
      } catch {
        return false;
      }
    },
    async disable() {
      if (platform !== 'win32') return false;
      try {
        await deleteTask();
        return true;
      } catch {
        return false;
      }
    },
  };
}
