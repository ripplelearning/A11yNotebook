import { describe, expect, it } from 'vitest';
import {
  assetTypes,
  createAssetRegistry,
  moveGridFocus,
  parseCsv,
  parseFlashcards,
  parseGridMarkdown,
  parseMindMap,
  parseOutline,
  scheduleCard,
  serializeCsv,
  serializeFlashcards,
  serializeGridMarkdown,
  serializeMindMap,
  serializeOutline,
  sortGrid,
  validateMindMap,
  validateCardSchedule,
} from '../shared/assets';

describe('asset registry', () => {
  it('resolves specialized suffixes case-insensitively and supports registration', () => {
    const registry = createAssetRegistry(assetTypes);
    registry.register({
      id: 'note',
      label: 'Note',
      extensions: ['.md'],
      parse: (source) => source,
      serialize: (value) => String(value),
    });
    expect(registry.resolve('Notes/PLAN.OUTLINE.MD')?.id).toBe('outline');
    expect(registry.resolve('cards.cards.md')?.id).toBe('flashcards');
    expect(registry.resolve('Map.mindmap.json')?.id).toBe('mindmap');
    expect(registry.resolve('table.csv')?.id).toBe('grid');
    expect(registry.resolve('table.grid.md')?.id).toBe('markdown-grid');
    expect(registry.resolve('plain.md')?.id).toBe('note');
    expect(registry.resolve('unknown.pdf')).toBeUndefined();
    expect(registry.list()).toHaveLength(6);
    expect(() => registry.register(registry.get('note')!)).toThrow('duplicate');
  });
});

describe('outline serialization', () => {
  it('reads mixed ordered/unordered nesting, tabs, CRLF, and blank lines', () => {
    const nodes = parseOutline('- Parent\r\n\t1. Child\r\n\t    + Grandchild\r\n\r\n- Other');
    expect(nodes.map((node) => node.text)).toEqual(['Parent', 'Other']);
    expect(nodes[0].children[0].ordered).toBe(true);
    expect(nodes[0].children[0].children[0].text).toBe('Grandchild');
    expect(parseOutline(serializeOutline(nodes))).toEqual(nodes);
  });
  it('round-trips multiline text including blank lines, leading spaces, and escaped list markers', () => {
    const nodes = parseOutline('- Root\n    - Child');
    nodes[0].text = 'Root\n- literal\n  2. literal\n\\- slash\n\nlast\n';
    expect(parseOutline(serializeOutline(nodes))).toEqual(nodes);
    expect(serializeOutline([])).toBe('');
    expect(parseOutline('')).toEqual([]);
  });
  it('rejects non-list text and orphan indentation rather than silently losing content', () => {
    expect(() => parseOutline('# Heading\n- Item')).toThrow('line 1');
    expect(() => parseOutline('  - Orphan')).toThrow('indentation');
  });
});

describe('mind map serialization', () => {
  const root = { id: 'root', text: 'Main', children: [{ id: 'child', text: 'Branch', children: [] }] };
  it('round-trips a validated tree without mutating it', () => {
    expect(parseMindMap(serializeMindMap(root))).toEqual(root);
    expect(serializeOutline([root])).toBe('- Main\n    - Branch\n');
  });
  it('rejects duplicate IDs, missing fields, invalid JSON, and cycles', () => {
    expect(() => validateMindMap({ ...root, children: [root] })).toThrow('unique');
    expect(() => parseMindMap('{"id":"a","text":4,"children":[]}')).toThrow();
    expect(() => parseMindMap('{')).toThrow();
    const cyclic = { id: 'cycle', text: 'Cycle', children: [] as unknown[] };
    cyclic.children.push(cyclic);
    expect(() => validateMindMap(cyclic)).toThrow();
  });
});

describe('flashcards and SM-2', () => {
  it('validates persisted schedules including UTC calendar dates', () => {
    const schedule = { repetitions: 2, interval: 6, ease: 2.5, due: '2026-01-01' };
    expect(validateCardSchedule(schedule)).toEqual(schedule);
    expect(() => validateCardSchedule({ ...schedule, due: '2026-02-30' })).toThrow();
    expect(() => validateCardSchedule({ ...schedule, interval: Infinity })).toThrow();
    expect(() => validateCardSchedule({ ...schedule, ease: 1.2 })).toThrow();
    expect(() => validateCardSchedule(null)).toThrow();
  });
  it('parses Q/A blocks, multiline answers, and inline cards and serializes them', () => {
    const cards = parseFlashcards('Capital :: Paris\n\nQ: Two plus two?\nA: Four\nExplanation\n\nQ: Color?\nA: Blue');
    expect(cards).toHaveLength(3);
    expect(cards[1].answer).toBe('Four\nExplanation');
    expect(parseFlashcards(serializeFlashcards(cards))).toEqual(cards);
    const escaped = [{ id: 'card-1', question: 'Markers?', answer: 'First\nQ: literal\nA: literal\n\\Q: slash' }];
    expect(parseFlashcards(serializeFlashcards(escaped))).toEqual(escaped);
    expect(() => parseFlashcards('Q: Missing answer')).toThrow();
    expect(() => parseFlashcards('Q: Missing marker\nNo marker')).toThrow();
    expect(() => parseFlashcards('Empty :: ')).toThrow();
    expect(() => serializeFlashcards([{ id: 'a', question: 'a\nb', answer: 'yes' }])).toThrow();
  });
  it('uses 1, 6, then ease-multiplied intervals and resets failed repetitions', () => {
    const first = scheduleCard(undefined, 5, '2026-01-31');
    expect(first).toEqual({ repetitions: 1, interval: 1, ease: 2.6, due: '2026-02-01' });
    const second = scheduleCard(first, 5, '2026-02-01');
    expect(second.interval).toBe(6);
    expect(second.due).toBe('2026-02-07');
    const third = scheduleCard(second, 4, '2026-02-07');
    expect(third.interval).toBe(16);
    const failed = scheduleCard(third, 0, '2026-02-23');
    expect(failed.repetitions).toBe(0);
    expect(failed.interval).toBe(1);
    expect(failed.ease).toBeGreaterThanOrEqual(1.3);
    expect(scheduleCard(failed, 3, '2026-02-24').interval).toBe(1);
    expect(second.repetitions).toBe(2);
  });
  it('validates dates, prior state and quality and applies the ease floor', () => {
    expect(() => scheduleCard(undefined, 6, '2026-01-01')).toThrow();
    expect(() => scheduleCard(undefined, 1.5, '2026-01-01')).toThrow();
    expect(() => scheduleCard(undefined, 4, '2026-02-30')).toThrow();
    expect(() => scheduleCard({ repetitions: -1, interval: 1, ease: 2.5, due: '' }, 4, '2026-01-01')).toThrow();
    expect(scheduleCard({ repetitions: 0, interval: 1, ease: 1.3, due: '' }, 0, '2026-01-01').ease).toBe(1.3);
  });
});

describe('grid serialization and navigation', () => {
  const grid = {
    columns: [' Name ', 'Details'],
    rows: [
      ['a,b', 'quote " and\r\nnewline'],
      ['pipe | slash \\', '<br> &amp; &#13;'],
      ['\t\u00a0', ''],
    ],
  };
  it('round-trips CSV quoting, CRLF, embedded newlines, and empty final cells', () => {
    expect(parseCsv(serializeCsv(grid))).toEqual(grid);
    expect(parseCsv('A,B\nx,\n')).toEqual({ columns: ['A', 'B'], rows: [['x', '']] });
    expect(parseCsv(serializeCsv({ columns: [''], rows: [['']] }))).toEqual({ columns: [''], rows: [['']] });
    expect(() => parseCsv('"unfinished')).toThrow();
    expect(() => parseCsv('A\n"closed"x')).toThrow();
    expect(() => parseCsv('A,B\nshort')).toThrow('rectangular');
  });
  it('round-trips Markdown table escapes, literal entities, and multiline cells', () => {
    expect(parseGridMarkdown(serializeGridMarkdown(grid))).toEqual(grid);
    expect(() => parseGridMarkdown('| A |\n| invalid |')).toThrow();
    expect(() => parseGridMarkdown('| A |\n| --- |\n| x | y |')).toThrow('rectangular');
  });
  it('sorts stably without mutation and validates the column', () => {
    const input = {
      columns: ['Name', 'ID'],
      rows: [
        ['b', '1'],
        ['a', '2'],
        ['b', '3'],
      ],
    };
    expect(sortGrid(input, 0, 'ascending').rows).toEqual([
      ['a', '2'],
      ['b', '1'],
      ['b', '3'],
    ]);
    expect(sortGrid(input, 0, 'descending').rows).toEqual([
      ['b', '1'],
      ['b', '3'],
      ['a', '2'],
    ]);
    expect(input.rows[0]).toEqual(['b', '1']);
    expect(() => sortGrid(input, -1, 'ascending')).toThrow();
  });
  it('moves and clamps at every edge including a header-only grid', () => {
    expect(moveGridFocus(1, 1, 'ArrowUp', 3, 3)).toEqual({ row: 0, column: 1 });
    expect(moveGridFocus(1, 1, 'ArrowDown', 3, 3)).toEqual({ row: 2, column: 1 });
    expect(moveGridFocus(1, 1, 'ArrowLeft', 3, 3)).toEqual({ row: 1, column: 0 });
    expect(moveGridFocus(1, 1, 'ArrowRight', 3, 3)).toEqual({ row: 1, column: 2 });
    expect(moveGridFocus(0, 0, 'ArrowUp', 1, 1)).toEqual({ row: 0, column: 0 });
    expect(moveGridFocus(0, 0, 'ArrowDown', 1, 1)).toEqual({ row: 0, column: 0 });
    expect(moveGridFocus(0, 0, 'ArrowLeft', 1, 1)).toEqual({ row: 0, column: 0 });
    expect(moveGridFocus(0, 0, 'ArrowRight', 1, 1)).toEqual({ row: 0, column: 0 });
  });
});
