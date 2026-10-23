// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseMoveJournal, planMoveRecovery, type MoveJournal } from '../../electron/vault/move-journal';

const journal: MoveJournal = {
  version: 1,
  source: 'Old.md',
  destination: 'New/Old.md',
  repairs: [
    { path: 'Ref.md', nextPath: 'Ref.md', before: '[x](Old.md)', after: '[x](New/Old.md)' },
    { path: 'Other.md', nextPath: 'Other.md', before: '[[Old]]', after: '[[New/Old]]' },
  ],
  startedAt: '2026-10-23T00:00:00.000Z',
};

describe('move journal', () => {
  it('parses a valid journal and rejects malformed values', () => {
    expect(parseMoveJournal(journal)?.source).toBe('Old.md');
    expect(parseMoveJournal(null)).toBeNull();
    expect(parseMoveJournal({ version: 2, source: 'a', destination: 'b', repairs: [] })).toBeNull();
    expect(parseMoveJournal({ version: 1, source: 'a', destination: 'b', repairs: [{ path: 'x' }] })).toBeNull();
  });

  it('rolls forward a crash before the rename: rename, rewrite pending notes, migrate', () => {
    const actions = planMoveRecovery(journal, {
      sourceExists: true,
      destinationExists: false,
      contents: new Map([
        ['Ref.md', '[x](Old.md)'],
        ['Other.md', '[[Old]]'],
      ]),
    });
    expect(actions.map((action) => action.kind)).toEqual(['rename', 'write-note', 'write-note', 'migrate']);
  });

  it('skips repairs already written before the crash and finishes the rest', () => {
    const actions = planMoveRecovery(journal, {
      sourceExists: false,
      destinationExists: true,
      contents: new Map([
        ['Ref.md', '[x](New/Old.md)'],
        ['Other.md', '[[Old]]'],
      ]),
    });
    expect(actions).toEqual([{ kind: 'write-note', path: 'Other.md' }, { kind: 'migrate' }]);
  });

  it('reports conflicts instead of overwriting notes that changed since the crash', () => {
    const actions = planMoveRecovery(journal, {
      sourceExists: false,
      destinationExists: true,
      contents: new Map([
        ['Ref.md', 'user edited this'],
        ['Other.md', '[[New/Old]]'],
      ]),
    });
    expect(actions).toEqual([
      { kind: 'conflict', path: 'Ref.md', reason: expect.stringContaining('changed') },
      { kind: 'migrate' },
    ]);
  });

  it('flags a both-exist state as a conflict and still migrates metadata', () => {
    const actions = planMoveRecovery(journal, {
      sourceExists: true,
      destinationExists: true,
      contents: new Map([
        ['Ref.md', '[x](New/Old.md)'],
        ['Other.md', '[[New/Old]]'],
      ]),
    });
    expect(actions[0].kind).toBe('conflict');
    expect(actions.at(-1)?.kind).toBe('migrate');
  });
});
