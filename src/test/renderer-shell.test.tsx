import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import App from '../renderer/App';

afterEach(() => {
  cleanup();
});

describe('renderer shell', () => {
  it('renders the application title and accessibility landmarks', () => {
    render(<App />);
    // The app name lives in the window titlebar, not as an in-page
    // heading, so screen readers are not forced through it on every view.
    expect(document.title).toContain('A11y Notebook');
    expect(screen.queryByRole('heading', { name: 'A11y Notebook' })).toBeNull();
    expect(screen.getByLabelText('Application header')).toBeTruthy();
    expect(screen.getByLabelText('Main menu')).toBeTruthy();
    expect(screen.getByLabelText('Status bar')).toBeTruthy();
  });
});
