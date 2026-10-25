import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PlainTextDocument from '../renderer/features/vault/PlainTextDocument';

describe('math in plain text', () => {
  it('renders math markers and math elements as MathML, like other note types', () => {
    render(
      <PlainTextDocument
        text={'Area is `math:sqrt(16)` and <math alttext="frac(1,2)"><mfrac><mn>1</mn><mn>2</mn></mfrac></math>.'}
      />,
    );
    const maths = document.querySelectorAll('math');
    expect(maths).toHaveLength(2);
    expect(maths[0].getAttribute('alttext')).toBe('sqrt(16)');
    expect(maths[1].getAttribute('alttext')).toBe('frac(1,2)');
    expect(screen.getByText(/Area is/)).toBeInTheDocument();
  });

  it('leaves unparseable markers literal and strips event handlers from raw math', () => {
    render(
      <PlainTextDocument
        text={'Bad `math:sqrt(` here and <math onclick="run()"><mi>x</mi></math> there.'}
      />,
    );
    expect(document.querySelectorAll('math')).toHaveLength(1);
    expect(document.querySelector('math')?.getAttribute('onclick')).toBeNull();
    expect(screen.getByText(/Bad/)).toBeInTheDocument();
  });
});
