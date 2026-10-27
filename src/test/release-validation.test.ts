import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Release tooling is a standalone Node module.
import { verifyArtifacts, verifyMetadata, verifyPackageVersions, verifyTag } from '../../scripts/verify-release.mjs';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const hasPowerShell = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;

describe('release workflow publication', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  const publish = workflow.split('      - name: Publish or update release only after validation\n')[1];
  // The workflow now has a second (macOS) job after the Windows publish
  // step; the extracted script must stop at that job boundary, or the
  // macOS job's YAML (including ${{ }} expressions) would be parsed
  // as PowerShell.
  const script = publish
    ?.split('        run: |\n')[1]
    ?.replace(/^ {10}/gm, '')
    ?.split(/^\n  [A-Za-z0-9_-]+:\s*$/m)[0];

  it('keeps exact-tag and main ancestry validation without rejecting existing release metadata', () => {
    const verify = workflow.split('      - name: Verify exact merged tag\n')[1]?.split('      - name:')[0];
    expect(verify).toContain('node scripts/verify-release.mjs tag "$env:RELEASE_TAG"');
    expect(verify).toContain('git merge-base --is-ancestor HEAD origin/main');
    expect(verify).not.toContain('gh ');
    expect(script).toBeDefined();
  });

  it('records desktop validation outcomes without gating publication on them', () => {
    expect(workflow).not.toContain('allow_desktop_validation_failure');
    expect(workflow).not.toContain('Require passing desktop checks');
    expect(workflow).not.toContain('Stable publication requires passing Windows desktop validation');
    expect(workflow).toContain('      - name: Record desktop validation outcomes');
    expect(workflow).toContain('      - name: Publish or update release only after validation');
    expect(workflow).toContain('cannot run on GitHub-hosted runners (session 0)');
  });

  const recordValidationStep = workflow
    .split('      - name: Record desktop validation outcomes\n')[1]
    ?.split('      - name:')[0]
    ?.split('        run: |\n')[1]
    ?.replace(/^ {10}/gm, '');
  if (!recordValidationStep) throw new Error('Desktop validation workflow step is missing.');
  const runDesktopValidation = (tag: string, uiAutomation: string, installerOverInstall: string) => {
    const directory = mkdtempSync(join(tmpdir(), 'a11y-desktop-validation-'));
    directories.push(directory);
    mkdirSync(join(directory, 'release'));
    writeFileSync(join(directory, 'release', 'SHA256SUMS.txt'), 'artifact-checksum  installer.exe\n');
    const scriptPath = join(directory, 'record-validation.ps1');
    writeFileSync(scriptPath, `$ErrorActionPreference = 'Stop'\n${recordValidationStep}`);
    const summaryPath = join(directory, 'summary.txt');
    const result = spawnSync('pwsh', ['-NoProfile', '-File', scriptPath], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        RELEASE_TAG: tag,
        UIA_OUTCOME: uiAutomation,
        UPGRADE_OUTCOME: installerOverInstall,
        GITHUB_STEP_SUMMARY: summaryPath,
      },
    });
    const validationPath = join(directory, 'release', 'desktop-validation.json');
    return {
      ...result,
      validation: existsSync(validationPath) ? JSON.parse(readFileSync(validationPath, 'utf8')) : undefined,
      checksums: readFileSync(join(directory, 'release', 'SHA256SUMS.txt'), 'utf8'),
      summary: existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : '',
      validationBytes: existsSync(validationPath) ? readFileSync(validationPath) : undefined,
    };
  };
  describe.skipIf(!hasPowerShell)('PowerShell desktop validation recording', { timeout: 60_000 }, () => {
    it.each([
      ['v1.1.7', 'failure', 'success'],
      ['v1.1.7', 'success', 'failure'],
      ['v1.1.7-rc.1', 'failure', 'success'],
      ['v1.1.7', 'success', 'success'],
    ])('records tag=%s with ui=%s upgrade=%s', (tag, uiAutomation, installerOverInstall) => {
      const result = runDesktopValidation(String(tag), String(uiAutomation), String(installerOverInstall));
      expect(result.status, result.stderr).toBe(0);
      expect(result.validation).not.toHaveProperty('overrideRequested');
      expect(result.validation).not.toHaveProperty('overrideUsed');
      expect(result.validation.uiAutomation).toBe(uiAutomation);
      expect(result.validation.installerOverInstall).toBe(installerOverInstall);
      expect(result.validation.updaterEndToEnd).toContain('not exercised');
      const validationBytes = result.validationBytes;
      if (!validationBytes) throw new Error('Desktop validation JSON was not written.');
      expect(result.checksums).toContain(
        `${createHash('sha256').update(validationBytes).digest('hex')}  desktop-validation.json`,
      );
      if (uiAutomation === 'failure' || installerOverInstall === 'failure') {
        if (uiAutomation === 'failure')
          expect(result.validation.failedChecks).toContainEqual({
            name: 'Windows desktop UI Automation',
            outcome: 'failure',
          });
        if (installerOverInstall === 'failure')
          expect(result.validation.failedChecks).toContainEqual({
            name: 'Installed upgrade smoke',
            outcome: 'failure',
          });
        expect(result.validation.warning).toContain('WARNING:');
        expect(result.summary).toContain('WARNING:');
        if (!String(tag).includes('-rc.')) expect(result.validation.warning).toContain('do not block publication');
      } else {
        expect(result.validation.failedChecks).toEqual([]);
        expect(result.validation.warning).toBeNull();
      }
    });

    it('records desktop checks that were not run instead of reporting success', () => {
      const result = runDesktopValidation('v1.1.7', 'failure', '');
      expect(result.status, result.stderr).toBe(0);
      expect(result.validation.installerOverInstall).toBe('not run');
      expect(result.validation.failedChecks).toContainEqual({
        name: 'Installed upgrade smoke',
        outcome: 'not run',
      });
      expect(result.validation.warning).toContain('Installed upgrade smoke (not run)');
    });
  });

  const runPublication = (existing: boolean, rc: boolean, failure = '', state = {}, desktop = {}) => {
    const directory = mkdtempSync(join(tmpdir(), 'a11y-publish-'));
    directories.push(directory);
    mkdirSync(join(directory, 'release'));
    writeFileSync(join(directory, 'release', 'installer.exe'), 'installer');
    const validation = JSON.stringify({
      uiAutomation: 'success',
      installerOverInstall: 'success',
      updaterEndToEnd: 'not exercised; stable clients do not opt into RC updates',
      failedChecks: [],
      warning: null,
      ...desktop,
    });
    writeFileSync(join(directory, 'release', 'desktop-validation.json'), validation);
    const callsPath = join(directory, 'calls.jsonl');
    const scriptPath = join(directory, 'publish.ps1');
    writeFileSync(
      scriptPath,
      `
$ErrorActionPreference = 'Stop'
function gh {
  ConvertTo-Json -InputObject @($args) -Compress | Add-Content $env:CALLS_PATH
  $global:LASTEXITCODE = 0
  $action = $args[1]
  if ($action -eq 'view' -and "$($args[-1])" -eq 'url') {
    if ($env:EXISTING_RELEASE -eq 'false') { $global:LASTEXITCODE = 1 }
    return
  }
  if ($action -eq $env:FAIL_ACTION) { $global:LASTEXITCODE = 1; return }
  if ($action -eq 'view') { return $env:RELEASE_STATE }
}
${script}`,
    );
    const result = spawnSync('pwsh', ['-NoProfile', '-File', scriptPath], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        RELEASE_TAG: rc ? 'v1.1.5-rc.1' : 'v1.1.5',
        GITHUB_REPOSITORY: 'example/repository',
        RUNNER_TEMP: directory,
        GITHUB_STEP_SUMMARY: join(directory, 'summary.txt'),
        CALLS_PATH: callsPath,
        EXISTING_RELEASE: String(existing),
        FAIL_ACTION: failure,
        RELEASE_STATE: JSON.stringify({
          isDraft: false,
          isPrerelease: rc,
          assets: [
            { name: 'installer.exe', size: 9 },
            { name: 'desktop-validation.json', size: Buffer.byteLength(validation) },
          ],
          url: 'https://example.com/release',
          ...state,
        }),
      },
    });
    const calls: string[][] = existsSync(callsPath)
      ? readFileSync(callsPath, 'utf8')
          .trim()
          .split(/\r?\n/)
          .map((line) => JSON.parse(line))
      : [];
    return {
      ...result,
      calls,
      notes: existsSync(join(directory, 'release-notes.txt'))
        ? readFileSync(join(directory, 'release-notes.txt'), 'utf8')
        : '',
    };
  };

  describe.skipIf(!hasPowerShell)('PowerShell publish script with mocked gh', { timeout: 60_000 }, () => {
    it.each([
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ])('publishes with existing=%s and rc=%s without overwriting assets', (existing, rc) => {
      const result = runPublication(existing, rc);
      expect(result.status, result.stderr).toBe(0);
      expect(result.calls.map((call) => call[1])).toEqual(['view', existing ? 'edit' : 'create', 'upload', 'view']);
      const metadata = result.calls[1];
      expect(metadata).toContain('--title');
      expect(metadata).toContain('--notes-file');
      expect(metadata).toContain(rc ? '--prerelease' : '--prerelease=false');
      expect(metadata).toContain(rc ? '--latest=false' : '--latest');
      expect(metadata).toContain(existing ? '--draft=false' : '--verify-tag');
      expect(metadata.some((argument) => argument.endsWith('installer.exe'))).toBe(false);
      expect(result.calls[2]).toContain('--clobber=false');
      expect(result.calls[2]).toEqual(expect.arrayContaining([expect.stringMatching(/installer\.exe$/)]));
      expect(result.calls[2]).toEqual(expect.arrayContaining([expect.stringMatching(/desktop-validation\.json$/)]));
    });

    it('publishes truthful notes for failed desktop checks', () => {
      const result = runPublication(
        true,
        false,
        '',
        {},
        {
          uiAutomation: 'failure',
          failedChecks: [{ name: 'Windows desktop UI Automation', outcome: 'failure' }],
          warning:
            'WARNING: Desktop checks did not pass (Windows desktop UI Automation (failure)). These checks require an interactive Windows desktop and cannot run on GitHub-hosted runners (session 0), so they do not block publication.',
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.notes).toContain('Windows desktop UI Automation: failure.');
      expect(result.notes).toContain('cannot run on GitHub-hosted runners (session 0)');
      expect(result.notes).toContain('must be run on a real Windows desktop before production promotion');
      expect(result.notes).not.toContain('Both automated desktop checks passed.');
      expect(result.notes).not.toContain('override');
    });

    it.each([false, true])('fails on an asset name collision with existing=%s', (existing) => {
      const result = runPublication(existing, false, 'upload');
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Asset upload failed; never overwrite release assets.');
      expect(result.calls.at(-1)?.[1]).toBe('upload');
    });

    it.each([false, true])('stops before uploading if metadata publication fails with existing=%s', (existing) => {
      const result = runPublication(existing, false, existing ? 'edit' : 'create');
      expect(result.status).not.toBe(0);
      expect(result.calls.map((call) => call[1])).toEqual(['view', existing ? 'edit' : 'create']);
    });

    it.each([
      { isDraft: true },
      { isPrerelease: true },
      { assets: [] },
      { assets: [{ name: 'installer.exe', size: 8 }] },
    ])('rejects incorrect published state or assets: %j', (state) => {
      const result = runPublication(true, false, '', state);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/Published release state is incorrect|Published asset missing or wrong size/);
    });
  });
});

describe.skipIf(!hasPowerShell)('Windows smoke PowerShell helpers', { timeout: 60_000 }, () => {
  const commonScript = resolve('scripts/windows-smoke-common.ps1').replace(/'/g, "''");
  const runPowerShell = (body: string) =>
    spawnSync('pwsh', ['-NoProfile', '-Command', `. '${commonScript}'\n${body}`], {
      encoding: 'utf8',
    });

  it('normalizes only a zero Windows revision and preserves prerelease identity', () => {
    const result = runPowerShell(`
      $ErrorActionPreference = 'Stop'
      Assert-SmokeProductVersion '1.1.1' '1.1.1.0'
      Assert-SmokeProductVersion '1.1.2-rc.3' '1.1.2.0-rc.3'
      Assert-SmokeProductVersion '1.1.2' '1.1.2.0+build.4'
      $invalidVersions = @(
        @{ Expected = '1.1.1'; Actual = '1.1.1.1'; Name = 'nonzero revision' },
        @{ Expected = '1.1.1'; Actual = '2.1.1.0'; Name = 'major mismatch' },
        @{ Expected = '1.1.1'; Actual = '1.2.1.0'; Name = 'minor mismatch' },
        @{ Expected = '1.1.1'; Actual = '1.1.2.0'; Name = 'patch mismatch' },
        @{ Expected = '1.1.1-rc.2'; Actual = '1.1.1.0-rc.3'; Name = 'prerelease mismatch' },
        @{ Expected = '1.1.1.0'; Actual = '1.1.1.0'; Name = 'malformed expected version' },
        @{ Expected = '1.1.1'; Actual = '1.1.1.0.0'; Name = 'malformed product version' },
        @{ Expected = '1.1.1'; Actual = '1.1.1.0-'; Name = 'malformed prerelease' }
      )
      foreach ($version in $invalidVersions) {
        $rejected = $false
        try { Assert-SmokeProductVersion $version.Expected $version.Actual; } catch { $rejected = $true }
        if (-not $rejected) { throw "Accepted $($version.Name)." }
      }
    `);
    expect(result.status, result.stderr).toBe(0);
  });

  it('reports empty paths and validates temporary roots', () => {
    const result = runPowerShell(`
      $ErrorActionPreference = 'Stop'
      $pathRejected = $false
      try { Join-SmokePath '' 'file.exe' 'test executable' } catch {
        $pathRejected = $_.Exception.Message -match 'base path is empty'
      }
      if (-not $pathRejected) { throw 'Empty path source was not diagnosed.' }
      $temp = Get-SmokeTempDirectory 'test profile'
      if ([string]::IsNullOrWhiteSpace($temp) -or -not (Test-Path -LiteralPath $temp -PathType Container)) {
        throw 'The temporary directory was not validated.'
      }
    `);
    expect(result.status, result.stderr).toBe(0);
  });

  it('does not evaluate an empty PSScriptRoot while binding UI smoke parameters', () => {
    const script = resolve('scripts/windows-ui-automation-smoke.ps1');
    const result = spawnSync('pwsh', ['-NoProfile', '-File', script], { encoding: 'utf8' });
    const uiScript = readFileSync(script, 'utf8');
    const upgradeScript = readFileSync('scripts/windows-installed-upgrade.ps1', 'utf8');
    expect(result.stderr).not.toContain('Join-Path');
    expect(result.stderr).toContain(
      process.platform === 'win32' ? 'Packaged application not found' : 'requires Windows UI Automation',
    );
    expect(uiScript).toContain('PSScriptRoot and PSCommandPath are empty');
    expect(upgradeScript).toContain('PSScriptRoot and PSCommandPath are empty');
  });
});

describe('exact-tag candidate validation', () => {
  it('runs package-only CLI validation without git or dependencies and propagates validation failures', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a11y-package-'));
    directories.push(directory);
    const version = '1.1.3';
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version }));
    const lock = { version, packages: { '': { version } } };
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock));
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, [resolve('scripts/verify-release.mjs'), ...args], {
        cwd: directory,
        encoding: 'utf8',
      });
    expect(cli('package').status).toBe(0);
    expect(cli('package', `v${version}`).status).not.toBe(0);
    expect(cli('tag', `v${version}`).status).not.toBe(0);
    expect(cli('artifacts', `v${version}`).status).not.toBe(0);
    expect(cli('unknown').status).not.toBe(0);
    lock.packages[''].version = '1.1.2';
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock));
    const result = cli('package');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Lockfile root package version must match');
  });

  it('keeps package and lockfile versions aligned with a valid release tag', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    expect(() => verifyPackageVersions(version, lock)).not.toThrow();
    expect(lock.version).toBe(version);
    expect(lock.packages[''].version).toBe(version);
    expect(() => verifyTag(`v${version}`, version, 'abc', 'abc')).not.toThrow();
  });

  it('requires plain semver package versions without a v prefix', () => {
    const lockFor = (version: string) => ({ version, packages: { '': { version } } });
    expect(() => verifyPackageVersions('1.1.3', lockFor('1.1.3'))).not.toThrow();
    expect(() => verifyPackageVersions('1.1.2-rc.1', lockFor('1.1.2-rc.1'))).not.toThrow();
    expect(() => verifyPackageVersions('v1.1.3', lockFor('v1.1.3'))).toThrow(/without a "v" prefix/);
    expect(() => verifyPackageVersions('v1.1.3', lockFor('1.1.3'))).toThrow(/without a "v" prefix/);
    expect(() => verifyPackageVersions('1.1.3', lockFor('v1.1.3'))).toThrow(/Lockfile version/);
    expect(() => verifyPackageVersions('1.1.3', { version: '1.1.3', packages: { '': { version: 'v1.1.3' } } })).toThrow(
      /Lockfile root package/,
    );
    expect(() => verifyTag('vv1.1.3', 'v1.1.3', 'abc', 'abc')).toThrow();
  });

  it('rejects branches, mismatched versions and wrong checkouts', () => {
    expect(() => verifyTag('v1.1.2-rc.1', '1.1.2-rc.1', 'abc', 'abc')).not.toThrow();
    expect(() => verifyTag('main', '1.1.2-rc.1', 'abc', 'abc')).toThrow();
    expect(() => verifyTag('v1.1.1', '1.1.2-rc.1', 'abc', 'abc')).toThrow();
    expect(() => verifyTag('v1.1.2-rc.1', '1.1.2-rc.1', 'abc', 'def')).toThrow();
  });

  it('requires nonempty artifacts, matching metadata and an isolated RC channel', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a11y-release-'));
    directories.push(directory);
    const version = '1.1.2-rc.1';
    const installer = `A11y-Notebook-Setup-${version}.exe`;
    const contents = Buffer.from('test installer bytes');
    const metadata = `version: ${version}\nfiles:\n  - url: ${installer}\n    sha512: ${createHash('sha512').update(contents).digest('base64')}\n    size: ${contents.length}\npath: ${installer}\nsha512: ${createHash('sha512').update(contents).digest('base64')}\n`;
    for (const name of [installer, `${installer}.blockmap`, `A11y-Notebook-Portable-${version}.exe`]) {
      writeFileSync(join(directory, name), contents);
    }
    writeFileSync(join(directory, 'rc.yml'), metadata);
    expect(verifyArtifacts(directory, version)).toHaveLength(4);
    expect(() => verifyMetadata(metadata, version, installer, Buffer.from('tampered'))).toThrow();
    expect(() => verifyMetadata(metadata, '1.1.1', installer, contents)).toThrow();
    expect(() =>
      verifyMetadata(metadata.replace('    sha512:', '    wrongHash:'), version, installer, contents),
    ).toThrow();
    writeFileSync(join(directory, 'latest.yml'), metadata);
    expect(() => verifyArtifacts(directory, version)).toThrow(/another updater channel/);
    rmSync(join(directory, 'latest.yml'));
    writeFileSync(join(directory, installer), '');
    expect(() => verifyArtifacts(directory, version)).toThrow(/empty artifact/);
  });

  it('rejects missing installers and blockmaps', () => {
    const directory = mkdtempSync(join(tmpdir(), 'a11y-stable-'));
    directories.push(directory);
    expect(() => verifyArtifacts(directory, '1.1.2')).toThrow();
    writeFileSync(join(directory, 'A11y-Notebook-Setup-1.1.2.exe'), 'bytes');
    expect(() => verifyArtifacts(directory, '1.1.2')).toThrow();
  });
});
