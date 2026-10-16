import { execFile } from 'node:child_process';
import path from 'node:path';

// The path is data in the environment, never PowerShell/C# source or a shell command line.
const chooserCommand = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NotebookOpenWith {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct OpenInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string File;
    [MarshalAs(UnmanagedType.LPWStr)] public string Class;
    public uint Flags;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
  public static extern int SHOpenWithDialog(IntPtr owner, ref OpenInfo info);
}
'@
$info = New-Object NotebookOpenWith+OpenInfo
$info.File = $env:A11Y_NOTEBOOK_OPEN_WITH_PATH
$info.Flags = 5
$result = [NotebookOpenWith]::SHOpenWithDialog([IntPtr]::Zero, [ref]$info)
if ($result -ne 0 -and $result -ne -2147023673) { exit 1 }
`;

export function openWithChooser(filename: string): Promise<void> {
  if (process.platform !== 'win32')
    return Promise.reject(
      new Error('Open With is unavailable on this platform. Use Show in folder to choose another app.'),
    );
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  if (!/^[a-z]:\\[^"\r\n]*$/i.test(systemRoot))
    return Promise.reject(new Error('The Windows system directory is unavailable.'));
  const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-EncodedCommand',
        Buffer.from(chooserCommand, 'utf16le').toString('base64'),
      ],
      { shell: false, windowsHide: true, env: { ...process.env, A11Y_NOTEBOOK_OPEN_WITH_PATH: filename } },
      (error) =>
        error
          ? reject(new Error('Windows could not display the Open With chooser. Use Show in folder instead.'))
          : resolve(),
    );
  });
}
