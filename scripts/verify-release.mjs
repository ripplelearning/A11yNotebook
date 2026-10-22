import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

export function verifyPackageVersions(version, lock) {
  // Package files hold plain semver; only the git tag carries the "v" prefix.
  assert.match(
    version,
    /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/,
    'Package version must be X.Y.Z or X.Y.Z-rc.N without a "v" prefix',
  );
  assert.equal(lock.version, version, 'Lockfile version must match package version');
  assert.equal(lock.packages[''].version, version, 'Lockfile root package version must match');
}

export function verifyTag(tag, version, head, taggedCommit) {
  assert.match(tag, /^v\d+\.\d+\.\d+(?:-rc\.\d+)?$/);
  assert.equal(tag, `v${version}`, 'Tag must match package version');
  assert.equal(head, taggedCommit, 'Checkout must be the exact tagged commit');
}

export function verifyMetadata(metadata, version, installer, contents) {
  // Match electron-builder's scalar fields, not arbitrary substrings in release notes.
  const scalar = (key, value) => {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(metadata, new RegExp(`^${key}: ['"]?${escaped}['"]?\\r?$`, 'm'));
  };
  scalar('version', version);
  scalar('path', installer);
  const hash = createHash('sha512').update(contents).digest('base64');
  scalar('sha512', hash);
  const escapedInstaller = installer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedHash = hash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    metadata,
    new RegExp(
      `^files:\\r?\\n  - url: ${escapedInstaller}\\r?\\n    sha512: ${escapedHash}\\r?\\n    size: ${contents.length}\\r?$`,
      'm',
    ),
  );
}

export function verifyArtifacts(directory, version) {
  const channel = version.includes('-rc.') ? 'rc' : 'latest';
  const installer = `A11y-Notebook-Setup-${version}.exe`;
  const required = [installer, `${installer}.blockmap`, `A11y-Notebook-Portable-${version}.exe`, `${channel}.yml`];
  for (const name of required) {
    assert.ok(statSync(`${directory}/${name}`).size > 0, `Missing or empty artifact: ${name}`);
  }
  assert.ok(
    statSync(`${directory}/win-unpacked/A11y Notebook.exe`).size > 0,
    'Missing or empty artifact: win-unpacked/A11y Notebook.exe',
  );
  const metadataFiles = readdirSync(directory).filter((name) => /^(latest|alpha|beta|rc)\.yml$/.test(name));
  assert.deepEqual(metadataFiles, [`${channel}.yml`], 'Do not publish metadata for another updater channel');
  verifyMetadata(
    readFileSync(`${directory}/${channel}.yml`, 'utf8'),
    version,
    installer,
    readFileSync(`${directory}/${installer}`),
  );
  return required;
}

function main() {
  const [, , command, tag] = process.argv;
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  verifyPackageVersions(version, lock);
  if (command === 'package') {
    assert.equal(tag, undefined, 'Package-only validation does not accept a tag');
    return;
  }
  if (command === 'candidate') {
    assert.equal(tag, undefined, 'Candidate artifact validation does not accept a tag');
    verifyArtifacts('release', version);
    return;
  }
  assert.ok(command === 'tag' || command === 'artifacts', 'Expected package, candidate, tag or artifacts command');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const commit = git('rev-parse', 'HEAD');
  verifyTag(tag, version, commit, git('rev-parse', `refs/tags/${tag}^{commit}`));
  if (command === 'artifacts') {
    const required = verifyArtifacts('release', version);
    const signatures = JSON.parse(readFileSync('release/signatures.json', 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(signatures.length, 3, 'Expected installer, portable and application signature results');
    const expectedStatus = process.env.FORCE_SIGNING === 'true' ? 'Valid' : 'NotSigned';
    assert.ok(
      signatures.every(({ status }) => status === expectedStatus),
      'Unexpected signature status',
    );
    writeFileSync(
      'release/provenance.json',
      `${JSON.stringify(
        {
          tag,
          commit,
          version,
          signing: expectedStatus,
          run: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
        },
        null,
        2,
      )}\n`,
    );
    const files = [...required, 'provenance.json', 'signatures.json'];
    writeFileSync(
      'release/SHA256SUMS.txt',
      files
        .map(
          (name) =>
            `${createHash('sha256')
              .update(readFileSync(`release/${name}`))
              .digest('hex')}  ${name}\n`,
        )
        .join(''),
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
