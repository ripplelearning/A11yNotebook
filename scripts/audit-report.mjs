import { readFile } from 'node:fs/promises';

// Report-only summary of an `npm audit --json` file. Exit code is always
// 0: this script reports, it does not gate a build. A failing audit is a
// finding to fix, not a reason to hide the report behind a red check.
const [file, label] = process.argv.slice(2);
if (!file || !label) {
  console.error('Usage: node scripts/audit-report.mjs <audit.json> <label>');
  process.exit(2);
}
let report;
try {
  report = JSON.parse(await readFile(file, 'utf8'));
} catch {
  console.log(`${label}: no audit report was produced.`);
  process.exit(0);
}
const counts = report.metadata?.vulnerabilities ?? {};
const total = counts.total ?? 0;
console.log(`${label}: ${total} vulnerabilities ` +
  `(critical ${counts.critical ?? 0}, high ${counts.high ?? 0}, ` +
  `moderate ${counts.moderate ?? 0}, low ${counts.low ?? 0}, info ${counts.info ?? 0})`);
const entries = Object.entries(report.vulnerabilities ?? {});
const serious = entries.filter(([, value]) => ['critical', 'high'].includes(value.severity));
if (!serious.length) {
  console.log(`${label}: no critical or high findings.`);
  process.exit(0);
}
for (const [name, value] of serious.sort((a, b) => a[0].localeCompare(b[0]))) {
  const via = (value.via ?? [])
    .map((item) => (typeof item === 'string' ? item : item.title ?? item.url ?? ''))
    .filter(Boolean)
    .join('; ');
  console.log(`- ${value.severity} ${name} (range ${value.range ?? 'unknown'}): ${via}`);
}
