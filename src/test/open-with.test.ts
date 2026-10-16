// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openWithWindows } from '../../electron/vault/open-with';

afterEach(() => vi.unstubAllGlobals());

describe('Windows native Open With handoff', () => {
  it('passes the exact filename as a single argument to the absolute bundled helper without a shell', async () => {
    const run = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const filename = 'C:\\Library\\日本語 & $(bad); %PATH% (original).pdf';
    expect(await openWithWindows(filename, 'win32', run as never)).toEqual({ cancelled: false });
    expect(run).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('A11yNotebook.OpenWith.exe'), [filename], {
      windowsHide: true,
      shell: false,
      maxBuffer: 64 * 1024,
    });
    const [executable] = run.mock.calls[0] as unknown as [string];
    expect(path.isAbsolute(executable)).toBe(true);
    expect(path.basename(path.dirname(executable))).toBe('native');
    expect(executable).not.toMatch(/powershell|cmd\.exe|rundll32|wscript/i);
  });

  it('resolves the helper from Electron resources rather than the working directory or PATH', async () => {
    const resourcesPath = path.resolve('packaged resources');
    vi.stubGlobal('process', { ...process, resourcesPath });
    const run = vi.fn(async () => ({ stdout: '', stderr: '' }));
    await openWithWindows('C:\\Library\\Original.pdf', 'win32', run as never);
    expect(run).toHaveBeenCalledWith(
      path.join(resourcesPath, 'native', 'A11yNotebook.OpenWith.exe'),
      ['C:\\Library\\Original.pdf'],
      expect.objectContaining({ shell: false }),
    );
  });

  it('returns cancellation only for the helper cancellation exit code', async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error('Cancelled'), { code: 2 });
    });
    await expect(openWithWindows('C:\\Library\\Original.pdf', 'win32', run as never)).resolves.toEqual({
      cancelled: true,
    });
  });

  it.each([1, 'ENOENT', 'EACCES', '2', undefined])(
    'reports helper failure %s without fallback commands',
    async (code) => {
      const run = vi.fn(async () => {
        throw Object.assign(new Error('Failure'), { code });
      });
      await expect(openWithWindows('C:\\Library\\Original.pdf', 'win32', run as never)).rejects.toThrow(
        'Windows could not open the application chooser',
      );
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['linux', 'darwin'] as const)('does not launch anything on %s', async (platform) => {
    const run = vi.fn();
    await expect(openWithWindows('/Library/Original.pdf', platform, run as never)).rejects.toThrow('only on Windows');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('native Open With packaging contract', () => {
  it('allows common external-only documents while excluding executables, scripts, and shortcuts', async () => {
    const source = await readFile('native/windows/OpenWith.cs', 'utf8');
    const extensions = [...source.matchAll(/case "(\.[a-z]+)":/g)].map((match) => match[1]).sort();
    expect(extensions).toEqual(
      [
        '.md',
        '.html',
        '.htm',
        '.txt',
        '.csv',
        '.pdf',
        '.epub',
        '.docx',
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.webp',
        '.bmp',
        '.json',
        '.rtf',
        '.doc',
        '.xls',
        '.xlsx',
        '.ppt',
        '.pptx',
        '.odt',
        '.ods',
        '.odp',
      ].sort(),
    );
    for (const extension of ['.exe', '.com', '.bat', '.cmd', '.ps1', '.js', '.vbs', '.lnk', '.url'])
      expect(extensions).not.toContain(extension);
    expect(source).toContain('return filename.EndsWith(".mindmap.json", StringComparison.OrdinalIgnoreCase);');
    expect(source).toContain('default:\n                return false;');
    expect(source).toContain("file.ReadByte() == 'M' && file.ReadByte() == 'Z'");
  });

  it('uses the documented STA chooser with execution but no registration or shell commands', async () => {
    const source = await readFile('native/windows/OpenWith.cs', 'utf8');
    expect(source).toContain('[STAThread]');
    expect(source).toContain('CharSet = CharSet.Unicode');
    expect(source).toContain('SHOpenWithDialog(IntPtr.Zero, ref info)');
    expect(source).toContain('OAIF_EXEC = 0x00000004');
    expect(source).toContain('OAIF_HIDE_REGISTRATION = 0x00000020');
    expect(source).toContain('OpenAsFlags.OAIF_EXEC | OpenAsFlags.OAIF_HIDE_REGISTRATION');
    expect(source).toContain('if (result == unchecked((int)0x800704C7)) return 2;');
    expect(source).toContain('return result < 0 ? 1 : 0;');
    expect(source).toContain('args.Length != 1');
    expect(source).toContain('Path.IsPathRooted(args[0])');
    expect(source).toContain('FileAttributes.Directory | FileAttributes.ReparsePoint | FileAttributes.Device');
    expect(source).toContain('if (!IsDocument(filename)) return 1;');
    expect(source).toContain("file.ReadByte() == 'M' && file.ReadByte() == 'Z'");
    expect(source).not.toMatch(/Process\.Start|Registry|powershell|cmd\.exe|OAIF_ALLOW_REGISTRATION/i);
  });

  it('compiles the source before Windows packaging and includes only the built helper as a resource', async () => {
    const config = await readFile('electron-builder.yml', 'utf8');
    const hook = await readFile('scripts/build-open-with.mjs', 'utf8');
    expect(config).toContain('beforePack: ./scripts/build-open-with.mjs');
    expect(config).toContain('from: out/native/A11yNotebook.OpenWith.exe');
    expect(config).toContain('to: native/A11yNotebook.OpenWith.exe');
    expect(hook).toContain("if (context.electronPlatformName !== 'win32') return;");
    expect(hook).toContain("if (process.platform !== 'win32')");
    expect(hook).toContain("'Framework', 'v4.0.30319', 'csc.exe'");
    expect(hook).toContain('await rm(destination, { force: true })');
    expect(hook).toContain('await run(');
    expect(hook).toContain('shell: false');
    expect(hook).toContain('await lstat(destination)');
    expect(hook).not.toMatch(/powershell|cmd\.exe|EncodedCommand/i);
  });
});
