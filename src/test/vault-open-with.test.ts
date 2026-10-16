// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { openWithWindows } from '../../electron/vault/open-with';

const mock = vi.hoisted(() => ({ execute: vi.fn(), fail: false }));
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    mock.execute(...args.slice(0, 3));
    (args[3] as (error: Error | null) => void)(mock.fail ? new Error('failed') : null);
  },
}));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.unstubAllEnvs();
  mock.execute.mockClear();
  mock.fail = false;
});

describe('OS Open With chooser', () => {
  it('uses the bundled native executable and treats metacharacters only as argument data', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const filename = 'C:\\Notes\\evil"; Start-Process calc; &%.md';
    await expect(openWithWindows(filename)).resolves.toEqual({ cancelled: false });
    const [executable, args, options] = mock.execute.mock.calls[0];
    expect(path.isAbsolute(executable)).toBe(true);
    expect(path.basename(executable)).toBe('A11yNotebook.OpenWith.exe');
    expect(path.basename(path.dirname(executable))).toBe('native');
    expect(options.shell).toBe(false);
    expect(options.windowsHide).toBe(true);
    expect(args).toEqual([filename]);
    expect(executable).not.toContain(filename);
    expect(executable).not.toMatch(/powershell|cmd\.exe|rundll32|wscript/i);
  });

  it('reports unavailable on non-Windows instead of falsely claiming a chooser opened', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    await expect(openWithWindows('/notes/Topic.md')).rejects.toThrow('only on Windows');
    expect(mock.execute).not.toHaveBeenCalled();
  });

  it('reports native chooser failures', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mock.fail = true;
    await expect(openWithWindows('C:\\Notes\\Topic.md')).rejects.toThrow('could not open the application chooser');
    expect(mock.execute).toHaveBeenCalledTimes(1);
  });
});
