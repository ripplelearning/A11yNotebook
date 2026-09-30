import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import App from '../renderer/App';

afterEach(() => {
  cleanup();
});

describe('renderer shell', () => {
  it('renders the application title and accessibility landmarks', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'A11y Notebook' })).toBeTruthy();
    expect(screen.getByLabelText('Application header')).toBeTruthy();
    expect(screen.getByLabelText('Main menu')).toBeTruthy();
    expect(screen.getByLabelText('Status bar')).toBeTruthy();
  });
});
