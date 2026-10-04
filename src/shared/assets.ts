export interface OutlineNode {
  id: string;
  text: string;
  children: OutlineNode[];
  ordered?: boolean;
}

export interface GridData {
  columns: string[];
  rows: string[][];
}

export interface Flashcard {
  id: string;
  question: string;
  answer: string;
}

export interface CardSchedule {
  repetitions: number;
  interval: number;
  ease: number;
  due: string;
}

export function validateCardSchedule(value: unknown): CardSchedule {
  if (!value || typeof value !== 'object') throw new Error('Invalid card schedule');
  const schedule = value as CardSchedule;
  const date = new Date(`${schedule.due}T00:00:00Z`);
  if (
    !Number.isInteger(schedule.repetitions) ||
    schedule.repetitions < 0 ||
    !Number.isInteger(schedule.interval) ||
    schedule.interval < 0 ||
    !Number.isFinite(schedule.ease) ||
    schedule.ease < 1.3 ||
    typeof schedule.due !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(schedule.due) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== schedule.due
  ) {
    throw new Error('Invalid card schedule');
  }
  return { repetitions: schedule.repetitions, interval: schedule.interval, ease: schedule.ease, due: schedule.due };
}

export interface AssetType<T = unknown> {
  id: string;
  label: string;
  extensions: readonly string[];
  parse: (source: string) => T;
  serialize: (value: T) => string;
}

/** Longest matching suffix wins, so specialized Markdown assets precede notes. */
export function createAssetRegistry(types: readonly AssetType[] = []) {
  const entries = new Map<string, AssetType>();
  const register = (type: AssetType) => {
    if (!type.id || !type.extensions.length || entries.has(type.id)) {
      throw new Error(`Invalid or duplicate asset type: ${type.id}`);
    }
    entries.set(type.id, type);
  };
  types.forEach(register);
  return {
    register,
    list: () => [...entries.values()],
    get: (id: string) => entries.get(id),
    resolve: (path: string) =>
      [...entries.values()]
        .flatMap((type) => type.extensions.map((extension) => ({ type, extension })))
        .filter(({ extension }) => path.toLowerCase().endsWith(extension.toLowerCase()))
        .sort((a, b) => b.extension.length - a.extension.length)[0]?.type,
  };
}

export function parseOutline(source: string): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: { node: OutlineNode; indent: number; contentIndent: number }[] = [];
  let nextId = 0;
  for (const [index, original] of source.replace(/\r\n?/g, '\n').split('\n').entries()) {
    const line = original.replace(/^[ \t]+/, (indent) => indent.replace(/\t/g, '    '));
    const match = /^(\s*)([-+*]|\d+[.)]) (.*)$/.exec(line);
    if (match) {
      const indent = match[1].length;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      if (!stack.length && indent !== 0) throw new Error(`Unexpected indentation at line ${index + 1}`);
      const node: OutlineNode = {
        id: `outline-${++nextId}`,
        text: match[3],
        children: [],
        ordered: /^\d/.test(match[2]),
      };
      (stack.at(-1)?.node.children ?? roots).push(node);
      stack.push({ node, indent, contentIndent: indent + match[2].length + 1 });
    } else {
      const current = stack.at(-1);
      const indent = /^ */.exec(line)![0].length;
      if (current && indent >= current.contentIndent) {
        current.node.text += `\n${line.slice(current.contentIndent).replace(/^(\s*)\\(\\|[-+*] |\d+[.)] )/, '$1$2')}`;
      } else if (line.trim()) {
        throw new Error(`Expected a list item at line ${index + 1}`);
      }
    }
  }
  return roots;
}

export function serializeOutline(nodes: readonly OutlineNode[]): string {
  const lines: string[] = [];
  const visit = (items: readonly OutlineNode[], depth: number) => {
    for (const node of items) {
      const prefix = `${'    '.repeat(depth)}${node.ordered ? '1.' : '-'} `;
      const [first, ...rest] = node.text.replace(/\r\n?/g, '\n').split('\n');
      lines.push(prefix + first);
      for (const line of rest) {
        lines.push(' '.repeat(prefix.length) + line.replace(/^(\s*)(\\|[-+*] |\d+[.)] )/, '$1\\$2'));
      }
      visit(node.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return lines.length ? `${lines.join('\n')}\n` : '';
}

export function validateMindMap(value: unknown): OutlineNode {
  const ids = new Set<string>();
  const visit = (input: unknown, depth: number): OutlineNode => {
    if (!input || typeof input !== 'object' || depth > 100) throw new Error('Invalid mind map node');
    const node = input as Partial<OutlineNode>;
    if (
      typeof node.id !== 'string' ||
      !node.id ||
      ids.has(node.id) ||
      typeof node.text !== 'string' ||
      !Array.isArray(node.children)
    ) {
      throw new Error('Mind map nodes need unique IDs, text, and children');
    }
    ids.add(node.id);
    return { id: node.id, text: node.text, children: node.children.map((child) => visit(child, depth + 1)) };
  };
  return visit(value, 0);
}

export function parseMindMap(source: string): OutlineNode {
  return validateMindMap(JSON.parse(source));
}

export function serializeMindMap(root: OutlineNode): string {
  return `${JSON.stringify(validateMindMap(root), null, 2)}\n`;
}

export function parseFlashcards(source: string): Flashcard[] {
  const cards: Flashcard[] = [];
  let question: string | undefined;
  let answer: string[] = [];
  let answerStarted = false;
  const finish = () => {
    if (question !== undefined) {
      const text = answer.join('\n').trim();
      if (!question.trim() || !text || !answerStarted) throw new Error('Each card needs a question and answer');
      cards.push({ id: `card-${cards.length + 1}`, question: question.trim(), answer: text });
    }
    question = undefined;
    answer = [];
    answerStarted = false;
  };
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^Q:\s*/i.test(line)) {
      finish();
      question = line.replace(/^Q:\s*/i, '');
    } else if (/^A:\s*/i.test(line) && question !== undefined) {
      answerStarted = true;
      answer.push(line.replace(/^A:\s*/i, ''));
    } else if (question !== undefined) {
      if (line.trim() && !answerStarted) throw new Error('Expected A: after Q:');
      answer.push(line.replace(/^\\([QA]:|\\)/i, '$1'));
    } else if (line.trim()) {
      const split = line.indexOf('::');
      if (split < 0) throw new Error('Use Q:/A: blocks or question :: answer');
      question = line.slice(0, split);
      answer = [line.slice(split + 2)];
      answerStarted = true;
      finish();
    }
  }
  finish();
  return cards;
}

export function serializeFlashcards(cards: readonly Flashcard[]): string {
  if (cards.some((card) => /[\r\n]/.test(card.question) || !card.question.trim() || !card.answer.trim())) {
    throw new Error('Cards require single-line questions and nonempty answers');
  }
  return cards
    .map((card) => {
      const [first, ...rest] = card.answer.replace(/\r\n?/g, '\n').split('\n');
      return `Q: ${card.question}\nA: ${first}${rest.map((line) => `\n${line.replace(/^([QA]:|\\)/i, '\\$1')}`).join('')}`;
    })
    .join('\n\n');
}

/** SM-2 quality is 0–5; dates are UTC calendar dates and intervals are days. */
export function scheduleCard(previous: CardSchedule | undefined, quality: number, today: string): CardSchedule {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) throw new Error('Quality must be 0–5');
  const date = new Date(`${today}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(today) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== today
  )
    throw new Error('Invalid review date');
  if (
    previous &&
    (!Number.isInteger(previous.repetitions) ||
      previous.repetitions < 0 ||
      !Number.isInteger(previous.interval) ||
      previous.interval < 0 ||
      !Number.isFinite(previous.ease) ||
      previous.ease < 1.3)
  )
    throw new Error('Invalid card schedule');
  const prior = previous ?? { repetitions: 0, interval: 0, ease: 2.5, due: today };
  const repetitions = quality < 3 ? 0 : prior.repetitions + 1;
  const interval =
    quality < 3
      ? 1
      : repetitions === 1
        ? 1
        : repetitions === 2
          ? 6
          : Math.max(1, Math.round(prior.interval * prior.ease));
  const ease = Math.max(1.3, prior.ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  date.setUTCDate(date.getUTCDate() + interval);
  return { repetitions, interval, ease, due: date.toISOString().slice(0, 10) };
}

export function validateGrid(grid: GridData): GridData {
  if (
    !Array.isArray(grid.columns) ||
    !grid.columns.length ||
    !grid.columns.every((cell) => typeof cell === 'string') ||
    !Array.isArray(grid.rows) ||
    !grid.rows.every(
      (row) =>
        Array.isArray(row) && row.length === grid.columns.length && row.every((cell) => typeof cell === 'string'),
    )
  ) {
    throw new Error('Grid must have columns and rectangular string rows');
  }
  return grid;
}

export function parseCsv(source: string): GridData {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
    closed = false;
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === ',' || char === '\n' || char === '\r') {
      endCell();
      if (char !== ',') {
        rows.push(row);
        row = [];
        if (char === '\r' && source[index + 1] === '\n') index++;
      }
    } else if (char === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error('Invalid CSV quoting');
      cell += char;
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (cell || row.length || closed || !rows.length) {
    endCell();
    rows.push(row);
  }
  return validateGrid({ columns: rows[0], rows: rows.slice(1) });
}

export function serializeCsv(grid: GridData): string {
  validateGrid(grid);
  return (
    [grid.columns, ...grid.rows]
      .map((row) => row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
      .join('\r\n') + '\r\n'
  );
}

export function serializeGridMarkdown(grid: GridData): string {
  validateGrid(grid);
  const row = (cells: string[]) =>
    `| ${cells
      .map((cell) =>
        cell
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/\\/g, '\\\\')
          .replace(/\|/g, '\\|')
          .replace(/\r/g, '&#13;')
          .replace(/\n/g, '<br>')
          .replace(/\t/g, '&#9;')
          .replace(/^ +| +$/g, (spaces) => '&#32;'.repeat(spaces.length)),
      )
      .join(' | ')} |`;
  return [row(grid.columns), row(grid.columns.map(() => '---')), ...grid.rows.map(row)].join('\n') + '\n';
}

export function parseGridMarkdown(source: string): GridData {
  const parseRow = (line: string) => {
    if (!line.trim().startsWith('|') || !line.trim().endsWith('|')) throw new Error('Expected a Markdown table');
    const cells: string[] = [];
    let cell = '';
    const inner = line.trim().slice(1, -1);
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '\\' && (inner[i + 1] === '\\' || inner[i + 1] === '|')) cell += inner[++i];
      else if (inner[i] === '|') {
        cells.push(cell);
        cell = '';
      } else cell += inner[i];
    }
    cells.push(cell);
    return cells.map((value) =>
      value
        .replace(/^ +| +$/g, '')
        .replace(/<br>/g, '\n')
        .replace(/&#13;/g, '\r')
        .replace(/&#9;/g, '\t')
        .replace(/&#32;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&'),
    );
  };
  const lines = source.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('Table needs headers and separator');
  const columns = parseRow(lines[0]);
  const separator = parseRow(lines[1]);
  if (separator.length !== columns.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    throw new Error('Invalid table separator');
  }
  return validateGrid({ columns, rows: lines.slice(2).map(parseRow) });
}

export function moveGridFocus(row: number, column: number, key: string, rows: number, columns: number) {
  if (rows < 1 || columns < 1) return { row: 0, column: 0 };
  return {
    row: Math.max(0, Math.min(rows - 1, row + (key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0))),
    column: Math.max(0, Math.min(columns - 1, column + (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0))),
  };
}

export function sortGrid(grid: GridData, column: number, direction: 'ascending' | 'descending'): GridData {
  validateGrid(grid);
  if (!Number.isInteger(column) || column < 0 || column >= grid.columns.length) throw new Error('Invalid column');
  return {
    columns: [...grid.columns],
    rows: [...grid.rows].sort((a, b) => {
      const left = a[column];
      const right = b[column];
      const comparison = left < right ? -1 : left > right ? 1 : 0;
      return direction === 'ascending' ? comparison : -comparison;
    }),
  };
}

export const assetTypes: readonly AssetType[] = [
  {
    id: 'outline',
    label: 'Outline',
    extensions: ['.outline.md'],
    parse: parseOutline,
    serialize: (value) => serializeOutline(value as OutlineNode[]),
  },
  {
    id: 'mindmap',
    label: 'Mind map',
    extensions: ['.mindmap.json'],
    parse: parseMindMap,
    serialize: (value) => serializeMindMap(value as OutlineNode),
  },
  {
    id: 'flashcards',
    label: 'Flashcards',
    extensions: ['.cards.md'],
    parse: parseFlashcards,
    serialize: (value) => serializeFlashcards(value as Flashcard[]),
  },
  {
    id: 'grid',
    label: 'Grid',
    extensions: ['.csv'],
    parse: parseCsv,
    serialize: (value) => serializeCsv(value as GridData),
  },
  {
    id: 'markdown-grid',
    label: 'Markdown grid',
    extensions: ['.grid.md'],
    parse: parseGridMarkdown,
    serialize: (value) => serializeGridMarkdown(value as GridData),
  },
];
