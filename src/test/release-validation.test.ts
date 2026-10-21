import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Release tooling is a standalone Node module.
import { verifyArtifacts, verifyMetadata, verifyPackageVersions, verifyTag } from '../../scripts/verify-release.mjs';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('exact-tag candidate validation', () => {
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
