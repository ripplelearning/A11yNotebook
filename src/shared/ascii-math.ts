/**
 * ASCII math to accessible MathML.
 *
 * Users type plain shorthand — sqrt(16), frac(1,2), x^2, abs(-3), 1.5e3,
 * 3x10^8 — and get MathML that browsers render natively and screen readers
 * can read, with the original ASCII kept in the `alttext` attribute.
 *
 * Supported shorthand:
 * - sqrt(x), root(n,x), frac(a,b), pow(a,b), abs(x)
 * - log(x), ln(x), sin(x), cos(x), tan(x), exp(x)
 * - ^ superscript, _ subscript, / fraction, div as the division sign
 * - pi, greek letters (alpha, beta, gamma, delta, theta, lambda, mu, sigma, omega),
 *   inf/infinity, rad and deg as unit words
 * - Scientific notation: 1.5e3, 3x10^8, 10^-6
 *
 * Anything that does not parse returns null; callers keep the original text
 * rather than emitting broken MathML.
 */

const MAX_INPUT_LENGTH = 500;

const GREEK: Record<string, string> = {
  pi: 'π',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  sigma: 'σ',
  omega: 'Ω',
  inf: '∞',
  infinity: '∞',
};

const UNIT_WORDS = new Set(['rad', 'deg']);
const FUNCTION_NAMES = new Set([
  'sqrt',
  'root',
  'frac',
  'pow',
  'abs',
  'log',
  'ln',
  'sin',
  'cos',
  'tan',
  'exp',
]);

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Token =
  | { type: 'number'; value: string }
  | { type: 'sci'; mantissa: string; exponent: string }
  | { type: 'word'; value: string }
  | { type: 'op'; value: string };

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const rest = input.slice(i);
    if (/^\s/.test(rest)) {
      i += 1;
      continue;
    }
    // Scientific form written out: 3x10^8 (the x is multiplication here, not a variable).
    const sciWritten = /^(\d+(?:\.\d+)?)\s*x\s*10\^([+-]?\d+)/.exec(rest);
    if (sciWritten) {
      tokens.push({ type: 'sci', mantissa: sciWritten[1], exponent: sciWritten[2] });
      i += sciWritten[0].length;
      continue;
    }
    const number = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) {
      const [raw] = number;
      const sci = /^(\d+(?:\.\d+)?)[eE]([+-]?\d+)$/.exec(raw);
      tokens.push(
        sci ? { type: 'sci', mantissa: sci[1], exponent: sci[2] } : { type: 'number', value: raw },
      );
      i += raw.length;
      continue;
    }
    const word = /^[A-Za-z]+/.exec(rest);
    if (word) {
      tokens.push(word[0] === 'div' ? { type: 'op', value: 'div' } : { type: 'word', value: word[0] });
      i += word[0].length;
      continue;
    }
    const char = rest[0];
    if ('+-*/=<>(),[]{}^_|!'.includes(char) || char === '×' || char === '·' || char === '÷') {
      tokens.push({ type: 'op', value: char === '*' ? '×' : char });
      i += 1;
      continue;
    }
    return null;
  }
  return tokens;
}

class Parser {
  private position = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): string | null {
    if (!this.tokens.length) return null;
    const body = this.expression();
    if (body === null || this.position !== this.tokens.length) return null;
    return body;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private next(): Token | undefined {
    return this.tokens[this.position++];
  }

  private expression(): string | null {
    let left = this.term();
    if (left === null) return null;
    for (;;) {
      const token = this.peek();
      if (!token) return left;
      if (token.type === 'op' && ['+', '-', '=', '<', '>'].includes(token.value)) {
        this.next();
        const right = this.term();
        if (right === null) return null;
        const symbol = token.value === '-' ? '−' : token.value;
        left = `<mrow>${left}<mo>${symbol}</mo>${right}</mrow>`;
        continue;
      }
      // Juxtaposition: "90 rad", "2x", "x y" are sequences, not one token.
      if (this.startsPrimary(token)) {
        const right = this.term();
        if (right === null) return null;
        left = `<mrow>${left}${right}</mrow>`;
        continue;
      }
      return left;
    }
  }

  private startsPrimary(token: Token): boolean {
    if (token.type === 'number' || token.type === 'sci' || token.type === 'word') return true;
    return (
      token.type === 'op' && (token.value === '(' || token.value === '[' || token.value === '{' || token.value === '|')
    );
  }

  private term(): string | null {
    let left = this.factor();
    if (left === null) return null;
    for (;;) {
      const token = this.peek();
      if (!token || token.type !== 'op' || !['×', '·', '/', 'div'].includes(token.value)) return left;
      this.next();
      const right = this.factor();
      if (right === null) return null;
      if (token.value === '/') left = `<mfrac>${left}${right}</mfrac>`;
      else if (token.value === 'div') left = `<mrow>${left}<mo>÷</mo>${right}</mrow>`;
      else left = `<mrow>${left}<mo>${token.value}</mo>${right}</mrow>`;
    }
  }

  private factor(): string | null {
    const token = this.peek();
    if (token?.type === 'op' && token.value === '-') {
      this.next();
      const operand = this.factor();
      return operand === null ? null : `<mrow><mo>−</mo>${operand}</mrow>`;
    }
    return this.power();
  }

  private power(): string | null {
    const base = this.postfix();
    if (base === null) return null;
    const token = this.peek();
    if (!token || token.type !== 'op' || (token.value !== '^' && token.value !== '_')) return base;
    this.next();
    const exponent = this.factor();
    if (exponent === null) return null;
    return token.value === '^' ? `<msup>${base}${exponent}</msup>` : `<msub>${base}${exponent}</msub>`;
  }

  private postfix(): string | null {
    let value = this.primary();
    if (value === null) return null;
    for (;;) {
      const token = this.peek();
      if (!token || token.type !== 'op' || (token.value !== '^' && token.value !== '_')) return value;
      this.next();
      const script = this.factor();
      if (script === null) return null;
      value = token.value === '^' ? `<msup>${value}${script}</msup>` : `<msub>${value}${script}</msub>`;
    }
  }

  private group(open: string, close: string): string | null {
    this.next();
    const inner = this.expression();
    if (inner === null) return null;
    const token = this.next();
    if (!token || token.type !== 'op' || token.value !== close) return null;
    const openSymbol = open === '{' ? '{' : open;
    return `<mrow><mo>${openSymbol}</mo>${inner}<mo>${close}</mo></mrow>`;
  }

  private functionCall(name: string): string | null {
    // Consume '(' then comma-separated arguments at the top level.
    this.next();
    const args: string[] = [];
    const first = this.peek();
    if (first?.type === 'op' && first.value === ')') {
      this.next();
      return null;
    }
    for (;;) {
      const arg = this.expression();
      if (arg === null) return null;
      args.push(arg);
      const token = this.next();
      if (!token || token.type !== 'op') return null;
      if (token.value === ')') break;
      if (token.value !== ',') return null;
    }
    if (name === 'sqrt' && args.length === 1) return `<msqrt>${args[0]}</msqrt>`;
    if (name === 'root' && args.length === 2) return `<mroot>${args[1]}${args[0]}</mroot>`;
    if (name === 'frac' && args.length === 2) return `<mfrac>${args[0]}${args[1]}</mfrac>`;
    if (name === 'pow' && args.length === 2) return `<msup>${args[0]}${args[1]}</msup>`;
    if (name === 'abs' && args.length === 1)
      return `<mrow><mo>|</mo>${args[0]}<mo>|</mo></mrow>`;
    if (['log', 'ln', 'sin', 'cos', 'tan', 'exp'].includes(name) && args.length === 1)
      return `<mrow><mi mathvariant="normal">${name}</mi><mo>(</mo>${args[0]}<mo>)</mo></mrow>`;
    return null;
  }

  private primary(): string | null {
    const token = this.next();
    if (!token) return null;
    if (token.type === 'number') return `<mn>${escapeXml(token.value)}</mn>`;
    if (token.type === 'sci') {
      const exponent = token.exponent.replace(/^\+/, '');
      return `<mrow><mn>${escapeXml(token.mantissa)}</mn><mo>×</mo><msup><mn>10</mn><mn>${escapeXml(exponent)}</mn></msup></mrow>`;
    }
    if (token.type === 'op') {
      if (token.value === '(') {
        this.position -= 1;
        return this.group('(', ')');
      }
      if (token.value === '[') {
        this.position -= 1;
        return this.group('[', ']');
      }
      if (token.value === '{') {
        this.position -= 1;
        return this.group('{', '}');
      }
      if (token.value === '|') {
        const inner = this.expression();
        if (inner === null) return null;
        const close = this.next();
        if (!close || close.type !== 'op' || close.value !== '|') return null;
        return `<mrow><mo>|</mo>${inner}<mo>|</mo></mrow>`;
      }
      return null;
    }
    const word = token.value;
    const next = this.peek();
    if (FUNCTION_NAMES.has(word) && next?.type === 'op' && next.value === '(') {
      return this.functionCall(word);
    }
    if (GREEK[word]) return `<mi>${GREEK[word]}</mi>`;
    if (UNIT_WORDS.has(word)) return `<mi mathvariant="normal">${escapeXml(word)}</mi>`;
    if (/^[A-Za-z]+$/.test(word)) {
      // Unknown multi-letter words are products of single variables (xy means x times y),
      // except the function names above, which are handled when followed by '('.
      return word
        .split('')
        .map((letter) => `<mi>${letter}</mi>`)
        .join('');
    }
    return null;
  }
}

/** Convert ASCII math to a MathML string, or null when it does not parse. */
export function asciiToMathML(input: string, display: 'inline' | 'block' = 'inline'): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_INPUT_LENGTH) return null;
  const tokens = tokenize(trimmed);
  if (!tokens) return null;
  const body = new Parser(tokens).parse();
  if (body === null) return null;
  const displayAttr = display === 'block' ? ' display="block"' : '';
  return `<math${displayAttr} alttext="${escapeXml(trimmed)}">${body}</math>`;
}

/**
 * Find an ASCII-math expression ending exactly at the caret in `text`, for
 * auto-conversion while typing. Only converts when the expression is not
 * glued to a preceding letter or digit, so ordinary words never convert.
 */
export function findTrailingMathExpression(text: string): { start: number; ascii: string } | null {
  if (!text) return null;
  const candidates: Array<{ start: number; ascii: string }> = [];
  // Function call with balanced parentheses ending at the caret.
  if (text.endsWith(')')) {
    let depth = 0;
    for (let i = text.length - 1; i >= 0; i -= 1) {
      if (text[i] === ')') depth += 1;
      else if (text[i] === '(') {
        depth -= 1;
        if (depth === 0) {
          const name = /([A-Za-z]+)$/.exec(text.slice(0, i))?.[1] ?? '';
          if (FUNCTION_NAMES.has(name)) {
            const start = i - name.length;
            candidates.push({ start, ascii: text.slice(start) });
          }
          break;
        }
      }
      if (depth < 0) break;
    }
  }
  const power = /(?:^|[\s(+\-×·*/=<>|])((?:[A-Za-z0-9]+|\([^()]*\))\^[+-]?[A-Za-z0-9]+)$/.exec(text);
  if (power) candidates.push({ start: text.length - power[1].length, ascii: power[1] });
  const sci = /(?:^|[\s(+\-×·*/=<>|])((?:\d+(?:\.\d+)?[eE][+-]?\d+|\d+(?:\.\d+)?\s*x\s*10\^[+-]?\d+))$/.exec(
    text,
  );
  if (sci) candidates.push({ start: text.length - sci[1].length, ascii: sci[1] });
  candidates.sort((a, b) => b.ascii.length - a.ascii.length);
  for (const candidate of candidates) {
    const before = candidate.start === 0 ? '' : text[candidate.start - 1];
    if (before && /[A-Za-z0-9)]/.test(before)) continue;
    if (asciiToMathML(candidate.ascii) !== null) return candidate;
  }
  return null;
}
