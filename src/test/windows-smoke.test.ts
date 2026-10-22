import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const hosts = (process.platform === 'win32' ? ['powershell', 'pwsh'] : ['pwsh']).filter(
  (host) => spawnSync(host, ['-NoProfile', '-Command', 'exit 0']).status === 0,
);

describe.each(hosts)('Windows smoke utilities under %s', (host) => {
  const run = (script: string) =>
    spawnSync(
      host,
      [
        '-NoProfile',
        '-Command',
        `$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest; . ${quote(resolve('scripts/windows-smoke-common.ps1'))}; ${script}`,
      ],
      { encoding: 'utf8' },
    );

  it.each([
    ['1.1.1.0', '1.1.1', true],
    ['1.1.1', '1.1.1.0', true],
    ['1.1.1+build.123', '1.1.1', true],
    ['1.1.7.0-rc.1+build', '1.1.7-rc.1', true],
    ['1.1.7-rc.1', '1.1.7', false],
    ['1.1.7', '1.1.7-rc.1', false],
    ['1.1.7-rc.1', '1.1.7-rc.2', false],
    ['1.1.7-RC.1', '1.1.7-rc.1', false],
    ['1.1.2.0', '1.1.1', false],
  ])('compares %s with %s as %s', (actual, expected, equivalent) => {
    const result = run(`Test-SmokeProductVersion ${quote(actual)} ${quote(expected)}`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(equivalent ? 'True' : 'False');
  });

  it.each(['1.1.1.1', '1.1.1.0.0', '', '1.1', 'v1.1.1', '1.1.1 garbage', '1.1.1+', '1.1.1\n'])(
    'rejects invalid or meaningful revision %s',
    (actual) => {
      const result = run(`Test-SmokeProductVersion ${quote(actual)} '1.1.1'`);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Unsupported product version');
    },
  );

  it('resolves the real parameter block under -File before any desktop operations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a11y smoke startup '));
    directories.push(directory);
    const scripts = join(directory, 'scripts');
    const unpacked = join(directory, 'release', 'win-unpacked');
    mkdirSync(scripts);
    mkdirSync(unpacked, { recursive: true });
    const executable = join(unpacked, 'A11y Notebook.exe');
    writeFileSync(executable, 'fixture, never executed');
    writeFileSync(join(scripts, 'windows-smoke-common.ps1'), readFileSync('scripts/windows-smoke-common.ps1', 'utf8'));
    const startup = readFileSync('scripts/windows-ui-automation-smoke.ps1', 'utf8').split(
      'if ([Environment]::OSVersion.Platform',
    )[0];
    const script = join(scripts, 'startup.ps1');
    writeFileSync(
      script,
      `${startup}\nResolve-SmokeExecutablePath $ExecutablePath $PSScriptRoot $MyInvocation.MyCommand.Path`,
    );
    const result = spawnSync(host, ['-NoProfile', '-File', script], { cwd: tmpdir(), encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(executable);
  });

  it('resolves defaults from the script location, falls back to its invocation path and validates explicit paths', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a11y smoke paths '));
    directories.push(directory);
    const scripts = join(directory, 'scripts');
    const unpacked = join(directory, 'release', 'win-unpacked');
    mkdirSync(scripts);
    mkdirSync(unpacked, { recursive: true });
    const executable = join(unpacked, 'A11y Notebook.exe');
    writeFileSync(executable, 'fixture, never executed');
    const valid = [
      `'' ${quote(scripts)} ''`,
      `'' '' ${quote(join(scripts, 'smoke.ps1'))}`,
      `${quote(executable)} '' ''`,
    ];
    const invalid = ["'' '' ''", "'' '' 'relative.ps1'", "'   ' '' ''", `${quote(scripts)} '' ''`];
    const result = run(
      [
        ...valid.map(
          (arguments_) =>
            `if ((Resolve-SmokeExecutablePath ${arguments_}) -cne ${quote(executable)}) { throw 'Wrong executable path' }`,
        ),
        ...invalid.map(
          (arguments_) =>
            `$rejected = $false; try { Resolve-SmokeExecutablePath ${arguments_} } catch { $rejected = $true }; if (-not $rejected) { throw 'Accepted invalid path' }`,
        ),
      ].join('; '),
    );
    expect(result.status, result.stderr).toBe(0);
    rmSync(executable);
    expect(run(`Resolve-SmokeExecutablePath '' ${quote(scripts)} ''`).status).not.toBe(0);
  });

  it.skipIf(process.platform === 'win32')('refuses desktop validation on non-Windows hosts', () => {
    const result = spawnSync(host, ['-NoProfile', '-File', resolve('scripts/windows-ui-automation-smoke.ps1')], {
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('requires Windows UI Automation');
    expect(result.stderr).not.toContain('Cannot bind argument');
  });
});

it('shares narrow product-version checks and resolves executable paths only in the script body', () => {
  for (const path of ['scripts/windows-ui-automation-smoke.ps1', 'scripts/windows-installed-upgrade.ps1']) {
    const script = readFileSync(path, 'utf8');
    expect(script).toContain(". (Join-Path $PSScriptRoot 'windows-smoke-common.ps1')");
    expect(script).toContain('Test-SmokeProductVersion');
  }
  const script = readFileSync('scripts/windows-ui-automation-smoke.ps1', 'utf8');
  expect(script.split("$ErrorActionPreference = 'Stop'")[0]).not.toContain('Join-Path');
  expect(script).toContain('Resolve-SmokeExecutablePath $ExecutablePath $PSScriptRoot $MyInvocation.MyCommand.Path');
  expect(script).toContain('[Environment]::UserInteractive');
  expect(script).toContain('if ($ownsProfile');
});
