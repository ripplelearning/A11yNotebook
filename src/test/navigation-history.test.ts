import { describe, expect, it } from 'vitest';
import {
  canGoBack,
  canGoForward,
  currentLocation,
  emptyNavigationHistory,
  goBack,
  goForward,
  recordLocation,
} from '../shared/navigation-history';

const loc = (tab: string, notebookPath?: string) => ({ tab, notebookPath });

describe('navigation history', () => {
  it('records locations and moves back and forward', () => {
    let state = emptyNavigationHistory();
    state = recordLocation(state, loc('contents'));
    state = recordLocation(state, loc('notebooks'));
    state = recordLocation(state, loc('notes-files', 'Research'));
    expect(currentLocation(state)).toEqual(loc('notes-files', 'Research'));
    expect(canGoBack(state)).toBe(true);
    expect(canGoForward(state)).toBe(false);

    const back = goBack(state);
    expect(back.location).toEqual(loc('notebooks'));
    expect(canGoForward(back.state)).toBe(true);
    const back2 = goBack(back.state);
    expect(back2.location).toEqual(loc('contents'));
    expect(canGoBack(back2.state)).toBe(false);
    expect(goBack(back2.state).location).toBeUndefined();

    const fwd = goForward(back2.state);
    expect(fwd.location).toEqual(loc('notebooks'));
  });

  it('treats a notebook change on the same tab as a distinct location', () => {
    let state = emptyNavigationHistory();
    state = recordLocation(state, loc('notes-files', 'Research'));
    state = recordLocation(state, loc('notes-files', 'Archive'));
    expect(state.entries).toHaveLength(2);
    expect(goBack(state).location).toEqual(loc('notes-files', 'Research'));
  });

  it('does not record a duplicate of the current location (restore no-op)', () => {
    let state = emptyNavigationHistory();
    state = recordLocation(state, loc('contents'));
    state = recordLocation(state, loc('notebooks'));
    const back = goBack(state);
    // Applying the restored location records it again in the app
    // effect; it must not truncate the forward entry.
    const after = recordLocation(back.state, loc('contents'));
    expect(after).toBe(back.state);
    expect(canGoForward(after)).toBe(true);
  });

  it('truncates forward entries when a new location is recorded after going back', () => {
    let state = emptyNavigationHistory();
    state = recordLocation(state, loc('contents'));
    state = recordLocation(state, loc('notebooks'));
    state = recordLocation(state, loc('tasks'));
    const back = goBack(goBack(state).state);
    const branched = recordLocation(back.state, loc('settings'));
    expect(branched.entries.map((entry) => entry.tab)).toEqual(['contents', 'settings']);
    expect(canGoForward(branched)).toBe(false);
  });

  it('caps the history length', () => {
    let state = emptyNavigationHistory();
    for (let i = 0; i < 150; i += 1) state = recordLocation(state, loc(`tab-${i}`));
    expect(state.entries.length).toBeLessThanOrEqual(100);
    expect(currentLocation(state)).toEqual(loc('tab-149'));
  });
});
