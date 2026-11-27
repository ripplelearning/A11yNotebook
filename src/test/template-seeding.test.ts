import { describe, expect, it } from 'vitest';
import { BUILT_IN_TEMPLATES } from '../shared/templates';
import {
  seedBuiltInTemplates,
  TEMPLATE_SEED_ATTEMPTS,
  type TemplateSeedDeps,
} from '../shared/template-seeding';
import type { VaultInfo } from '../shared/types';

function viewFor(paths: string[]): VaultInfo {
  return {
    name: 'library',
    path: '/library',
    entries: paths.map((path) => ({
      name: path.split('/').pop() ?? path,
      path,
      kind: 'note' as const,
    })),
  };
}

interface Harness {
  deps: TemplateSeedDeps;
  created: string[];
  calls: { createNote: number; getLibrary: number };
  delays: number[];
  errors: { template: string; error: unknown }[];
}

function makeHarness(options?: {
  failFirst?: Set<string>;
  failAlways?: Set<string>;
  preexisting?: Set<string>;
  current?: () => boolean;
}): Harness {
  const created = new Set<string>(options?.preexisting ?? []);
  const calls = { createNote: 0, getLibrary: 0 };
  const delays: number[] = [];
  const errors: { template: string; error: unknown }[] = [];
  const failedOnce = new Set<string>();
  const deps: TemplateSeedDeps = {
    createNote: async (relativePath: string) => {
      calls.createNote += 1;
      if (options?.failAlways?.has(relativePath)) throw new Error(`copy failed: ${relativePath}`);
      if (options?.failFirst?.has(relativePath) && !failedOnce.has(relativePath)) {
        failedOnce.add(relativePath);
        throw new Error(`copy failed once: ${relativePath}`);
      }
      created.add(relativePath);
      return viewFor([...created]);
    },
    getLibrary: async () => {
      calls.getLibrary += 1;
      return viewFor([...created]);
    },
    isCurrent: options?.current ?? (() => true),
    delay: async (ms: number) => {
      delays.push(ms);
    },
    logError: (template: string, error: unknown) => {
      errors.push({ template, error });
    },
  };
  return { deps, created: [...created], calls, delays, errors };
}

describe('seedBuiltInTemplates', () => {
  it('copies every missing template on the first pass', async () => {
    const harness = makeHarness();
    const result = await seedBuiltInTemplates(BUILT_IN_TEMPLATES, [], harness.deps);
    expect(result).toEqual({
      allSeeded: true,
      failed: [],
      latestLibrary: viewFor([
        'Templates/Daily.md',
        'Templates/Meeting.md',
        'Templates/Project.md',
        'Templates/Reading.md',
        'Templates/Lecture.md',
      ]),
    });
    expect(harness.calls.createNote).toBe(5);
    expect(harness.calls.getLibrary).toBe(0);
    expect(harness.delays).toEqual([]);
    expect(harness.errors).toEqual([]);
  });

  it('retries a template whose first copy fails and still seeds them all', async () => {
    const harness = makeHarness({ failFirst: new Set(['Templates/Daily.md']) });
    const result = await seedBuiltInTemplates(BUILT_IN_TEMPLATES, [], harness.deps);
    expect(result.allSeeded).toBe(true);
    expect(result.failed).toEqual([]);
    // Daily needed a second pass; the other four landed on the first.
    expect(harness.calls.createNote).toBe(6);
    expect(harness.calls.getLibrary).toBe(1);
    expect(harness.delays).toHaveLength(1);
    expect(harness.errors).toHaveLength(1);
    expect(harness.errors[0]?.template).toBe('Daily');
  });

  it('keeps seeding the rest when one template fails on every pass', async () => {
    const harness = makeHarness({ failAlways: new Set(['Templates/Meeting.md']) });
    const result = await seedBuiltInTemplates(BUILT_IN_TEMPLATES, [], harness.deps);
    expect(result.allSeeded).toBe(false);
    expect(result.failed).toEqual(['Meeting']);
    expect(result.latestLibrary).toEqual(
      viewFor(['Templates/Daily.md', 'Templates/Project.md', 'Templates/Reading.md', 'Templates/Lecture.md']),
    );
    // Meeting was attempted once per pass; the others once each.
    expect(harness.calls.createNote).toBe(4 + TEMPLATE_SEED_ATTEMPTS);
    expect(harness.errors.map((entry) => entry.template)).toEqual(['Meeting', 'Meeting', 'Meeting']);
  });

  it('counts a template as seeded when the refreshed view already has it', async () => {
    // Every copy reports a failure on the first pass, but the refreshed
    // library view shows Daily is already there (the file existed all
    // along): it is dropped without another create, and the rest land
    // on the retry pass.
    const harness = makeHarness({
      failFirst: new Set([
        'Templates/Daily.md',
        'Templates/Meeting.md',
        'Templates/Project.md',
        'Templates/Reading.md',
        'Templates/Lecture.md',
      ]),
      preexisting: new Set(['Templates/Daily.md']),
    });
    const result = await seedBuiltInTemplates(BUILT_IN_TEMPLATES, [], harness.deps);
    expect(result.allSeeded).toBe(true);
    expect(result.failed).toEqual([]);
    expect(harness.calls.createNote).toBe(9);
    expect(harness.calls.getLibrary).toBe(1);
  });

  it('stops quietly when the library changes mid-run', async () => {
    let calls = 0;
    const harness = makeHarness({
      current: () => {
        calls += 1;
        return calls <= 2;
      },
    });
    const result = await seedBuiltInTemplates(BUILT_IN_TEMPLATES, [], harness.deps);
    expect(result.allSeeded).toBe(false);
    expect(result.failed.length).toBeGreaterThan(0);
  });

  it('survives a failing library refresh and keeps retrying', async () => {
    const harness = makeHarness({ failFirst: new Set(['Templates/Daily.md']) });
    harness.deps.getLibrary = async () => {
      harness.calls.getLibrary += 1;
      throw new Error('refresh failed');
    };
    const result = await seedBuiltInTemplates(BUILT_IN_TEMPLATES, [], harness.deps);
    // The refresh failure is logged, but the retry still runs against
    // the last known view and the copy lands on its second attempt.
    expect(result.allSeeded).toBe(true);
    expect(harness.errors.some((entry) => entry.template === '(library refresh)')).toBe(true);
  });

  it('seeds nothing and reports success when nothing is missing', async () => {
    const harness = makeHarness();
    const result = await seedBuiltInTemplates([], ['Templates/Daily.md'], harness.deps);
    expect(result).toEqual({ allSeeded: true, failed: [], latestLibrary: null });
    expect(harness.calls.createNote).toBe(0);
    expect(harness.calls.getLibrary).toBe(0);
  });

  it('skips templates the initial view already has', async () => {
    const harness = makeHarness();
    const result = await seedBuiltInTemplates(BUILT_IN_TEMPLATES, ['Templates/Daily.md'], harness.deps);
    expect(result.allSeeded).toBe(true);
    expect(harness.calls.createNote).toBe(4);
  });
});
