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

describe('release workflow publication', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  const publish = workflow.split('      - name: Publish or update release only after validation\n')[1];
  const script = publish?.split('        run: |\n')[1]?.replace(/^ {10}/gm, '');
  const hasPowerShell = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;

  it('keeps exact-tag and main ancestry validation without rejecting existing release metadata', () => {
    const verify = workflow.split('      - name: Verify exact merged tag\n')[1]?.split('      - name:')[0];
    expect(verify).toContain('node scripts/verify-release.mjs tag "$env:RELEASE_TAG"');
    expect(verify).toContain('git merge-base --is-ancestor HEAD origin/main');
    expect(verify).not.toContain('gh ');
    expect(script).toBeDefined();
  });

  const runPublication = (existing: boolean, rc: boolean, failure = '', state = {}) => {
    const directory = mkdtempSync(join(tmpdir(), 'a11y-publish-'));
    directories.push(directory);
    mkdirSync(join(directory, 'release'));
    writeFileSync(join(directory, 'release', 'installer.exe'), 'installer');
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
          assets: [{ name: 'installer.exe', size: 9 }],
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
    return { ...result, calls };
  };

  describe.skipIf(!hasPowerShell)('PowerShell publish script with mocked gh', () => {
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
