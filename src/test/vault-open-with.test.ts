// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openWithChooser } from '../../electron/vault/open-with';

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
  it('uses a fixed executable and encoded constant command; treats metacharacters only as data', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vi.stubEnv('SystemRoot', 'C:\\Windows');
    const filename = 'C:\\Notes\\evil"; Start-Process calc; &%.md';
    await openWithChooser(filename);
    const [executable, args, options] = mock.execute.mock.calls[0];
    expect(executable).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(options.shell).toBe(false);
    expect(options.env.A11Y_NOTEBOOK_OPEN_WITH_PATH).toBe(filename);
    expect(args).toContain('-STA');
    expect(args).not.toContain(filename);
    const command = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    expect(command).toContain('SHOpenWithDialog');
    expect(command).not.toContain(filename);
    expect(command).not.toMatch(/rundll32|Invoke-Expression|Set-ItemProperty/i);
  });

  it('reports unavailable on non-Windows instead of falsely claiming a chooser opened', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    await expect(openWithChooser('/notes/Topic.md')).rejects.toThrow('unavailable on this platform');
    expect(mock.execute).not.toHaveBeenCalled();
  });

  it('reports native chooser failures', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vi.stubEnv('SystemRoot', 'C:\\Windows');
    mock.fail = true;
    await expect(openWithChooser('C:\\Notes\\Topic.md')).rejects.toThrow('could not display');
  });
});
