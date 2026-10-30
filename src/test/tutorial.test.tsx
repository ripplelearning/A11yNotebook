import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import App from '../renderer/App';
import { dispatchCommand, type CommandActionContext } from '../shared/command-registry';

const VERSION = '9.9.9-test';

function setTutorialState(state: unknown) {
  window.localStorage.setItem('a11y-notebook.tutorial', JSON.stringify(state));
}

beforeEach(() => {
  vi.stubGlobal('__APP_VERSION__', VERSION);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  delete window.a11yNotebook;
});

describe('guided tour', () => {
  it('shows the tour on a first run', () => {
    window.localStorage.removeItem('a11y-notebook.tutorial');
    render(<App />);
    expect(screen.getByRole('dialog', { name: 'Welcome Tutorial' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome to A11y Notebook' })).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 6')).toBeInTheDocument();
  });

  it('pages forward and back, moving focus to each page heading', () => {
    window.localStorage.removeItem('a11y-notebook.tutorial');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const second = screen.getByRole('heading', { name: 'Libraries and notebooks' });
    expect(second).toBeInTheDocument();
    expect(second).toHaveFocus();
    expect(screen.getByText('Page 2 of 6')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    const first = screen.getByRole('heading', { name: 'Welcome to A11y Notebook' });
    expect(first).toBeInTheDocument();
    expect(first).toHaveFocus();
  });

  it('closes from Finish on the last page', () => {
    window.localStorage.removeItem('a11y-notebook.tutorial');
    render(<App />);
    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    expect(screen.getByText('Page 6 of 6')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.queryByRole('dialog', { name: 'Welcome Tutorial' })).not.toBeInTheDocument();
  });

  it('does not show again after "Don\'t show this again" is checked', () => {
    window.localStorage.removeItem('a11y-notebook.tutorial');
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByLabelText("Don't show this again"));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(JSON.parse(window.localStorage.getItem('a11y-notebook.tutorial') ?? '{}').suppressed).toBe(true);
    unmount();
    render(<App />);
    expect(screen.queryByRole('dialog', { name: 'Welcome Tutorial' })).not.toBeInTheDocument();
  });

  it('does not auto-show for the same version', () => {
    setTutorialState({ suppressed: false, lastVersionSeen: VERSION });
    render(<App />);
    expect(screen.queryByRole('dialog', { name: 'Welcome Tutorial' })).not.toBeInTheDocument();
  });

  it('auto-shows after an update and records the new version', () => {
    setTutorialState({ suppressed: false, lastVersionSeen: '9.9.8-test' });
    render(<App />);
    expect(screen.getByRole('dialog', { name: 'Welcome Tutorial' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(JSON.parse(window.localStorage.getItem('a11y-notebook.tutorial') ?? '{}').lastVersionSeen).toBe(VERSION);
  });

  it('opens from the Help command', () => {
    const showTutorial = vi.fn();
    dispatchCommand('show-tutorial', { showTutorial } as unknown as CommandActionContext);
    expect(showTutorial).toHaveBeenCalledTimes(1);
  });
});
