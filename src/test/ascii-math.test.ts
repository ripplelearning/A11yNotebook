import { describe, expect, it } from 'vitest';
import { asciiToMathML, findTrailingMathExpression } from '../shared/ascii-math';

describe('asciiToMathML', () => {
  it('translates the documented shorthand', () => {
    expect(asciiToMathML('sqrt(16)')).toBe('<math alttext="sqrt(16)"><msqrt><mn>16</mn></msqrt></math>');
    expect(asciiToMathML('frac(1,2)')).toBe('<math alttext="frac(1,2)"><mfrac><mn>1</mn><mn>2</mn></mfrac></math>');
    expect(asciiToMathML('x^2')).toContain('<msup><mi>x</mi><mn>2</mn></msup>');
    expect(asciiToMathML('abs(-3)')).toContain('<mo>|</mo>');
    expect(asciiToMathML('pi')).toContain('<mi>π</mi>');
    expect(asciiToMathML('log(100)')).toContain('log');
    expect(asciiToMathML('a div b')).toContain('<mo>÷</mo>');
    expect(asciiToMathML('pow(x,2)')).toContain('<msup>');
    expect(asciiToMathML('x_1 + y_2')).toContain('<msub>');
  });

  it('renders scientific notation as mantissa times a power of ten', () => {
    expect(asciiToMathML('1.5e3')).toContain('<mn>1.5</mn><mo>×</mo><msup><mn>10</mn><mn>3</mn></msup>');
    expect(asciiToMathML('3x10^8')).toContain('<mn>3</mn><mo>×</mo><msup><mn>10</mn><mn>8</mn></msup>');
    expect(asciiToMathML('10^-6')).toContain('<msup><mn>10</mn>');
  });

  it('keeps radians as a unit word and fractions from slash division', () => {
    expect(asciiToMathML('90 rad')).toContain('<mi mathvariant="normal">rad</mi>');
    expect(asciiToMathML('1/2 + 3')).toContain('<mfrac><mn>1</mn><mn>2</mn></mfrac>');
  });

  it('rejects broken input instead of emitting broken MathML', () => {
    expect(asciiToMathML('')).toBeNull();
    expect(asciiToMathML('sqrt(')).toBeNull();
    expect(asciiToMathML('frac(1)')).toBeNull();
    expect(asciiToMathML('x^^2')).toBeNull();
    expect(asciiToMathML('hello @ world')).toBeNull();
  });

  it('escapes the alttext attribute', () => {
    expect(asciiToMathML('x < y')).toContain('alttext="x &lt; y"');
  });
});

describe('findTrailingMathExpression', () => {
  it('finds function calls, powers, and scientific notation at the caret', () => {
    expect(findTrailingMathExpression('The answer is sqrt(16)')).toEqual({
      start: 14,
      ascii: 'sqrt(16)',
    });
    expect(findTrailingMathExpression('area = x^2')).toEqual({ start: 7, ascii: 'x^2' });
    expect(findTrailingMathExpression('mass 1.5e3')).toEqual({ start: 5, ascii: '1.5e3' });
  });

  it('never converts ordinary words', () => {
    expect(findTrailingMathExpression('catalog')).toBeNull();
    expect(findTrailingMathExpression('the log book')).toBeNull();
    expect(findTrailingMathExpression('hello')).toBeNull();
  });
});
