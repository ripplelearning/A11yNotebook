import { execFile } from 'node:child_process';
import { lstat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export default async function beforePack(context) {
  if (context.electronPlatformName !== 'win32') return;
  if (process.platform !== 'win32')
    throw new Error('Windows packaging requires Windows to compile the native Open With helper.');
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  if (!path.win32.isAbsolute(systemRoot)) throw new Error('Windows SystemRoot must be absolute.');
  const compiler = path.join(systemRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe');
  if (!(await lstat(compiler)).isFile()) throw new Error('The Windows .NET Framework C# compiler is required.');
  const project = context.packager.projectDir;
  const source = path.join(project, 'native', 'windows', 'OpenWith.cs');
  const destination = path.join(project, 'out', 'native', 'A11yNotebook.OpenWith.exe');
  await mkdir(path.dirname(destination), { recursive: true });
  await rm(destination, { force: true });
  await run(compiler, ['/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', `/out:${destination}`, source], {
    shell: false,
    windowsHide: true,
  });
  if (!(await lstat(destination)).isFile()) throw new Error('Native Open With helper was not built.');
}
