import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

export async function openWithWindows(
  filename: string,
  platform: NodeJS.Platform = process.platform,
  run: typeof execFileAsync = execFileAsync,
): Promise<{ cancelled: boolean }> {
  if (platform !== 'win32')
    throw new Error(
      'The application chooser is currently available only on Windows. Use Open externally for the default application.',
    );
  const resources = process.resourcesPath ?? path.resolve(__dirname, '../../../out');
  const helper = path.resolve(resources, 'native', 'A11yNotebook.OpenWith.exe');
  try {
    await run(helper, [filename], {
      windowsHide: true,
      shell: false,
      maxBuffer: 64 * 1024,
    });
    return { cancelled: false };
  } catch (error) {
    if ((error as { code?: unknown }).code === 2) return { cancelled: true };
    throw new Error(
      'Windows could not open the application chooser. Try Open externally or Windows Default Apps settings.',
    );
  }
}
const execFileAsync = promisify(execFile);
