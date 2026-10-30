/**
 * Browsing history for the shell: a back/forward stack of locations,
 * where a location is the selected tab (a screen or an open note)
 * plus the notebook context it was viewed in. Pure state transitions
 * so the renderer's effect only has to compare and apply.
 */

export interface NavigationLocation {
  tab: string;
  notebookPath?: string;
}

export interface NavigationHistoryState {
  entries: NavigationLocation[];
  /** Index of the current location within entries, or -1 when empty. */
  index: number;
}

export const NAVIGATION_HISTORY_LIMIT = 100;

export function emptyNavigationHistory(): NavigationHistoryState {
  return { entries: [], index: -1 };
}

export function sameLocation(a: NavigationLocation, b: NavigationLocation): boolean {
  return a.tab === b.tab && a.notebookPath === b.notebookPath;
}

export function currentLocation(state: NavigationHistoryState): NavigationLocation | undefined {
  return state.index >= 0 ? state.entries[state.index] : undefined;
}

/**
 * Screens whose view is defined by the notebook context (the notes grid
 * shows that notebook's files). Every other tab is a document view — an
 * open note, an attachment, an asset — whose content does not depend on
 * which notebook the tree currently points at.
 */
const CONTEXT_SCREENS = new Set(['libraries', 'notebooks', 'notes-files', 'tasks', 'reminders', 'calendar', 'contents']);

export function isDocumentTab(tab: string): boolean {
  return !CONTEXT_SCREENS.has(tab);
}

/**
 * Record a location as the newest entry. Recording the location that
 * is already current is a no-op, which is also how a restored
 * (back/forward) location avoids being recorded again: after a jump
 * the index points at an entry equal to the applied location.
 * Recording after going back truncates the forward entries, like a
 * browser.
 */
export function recordLocation(
  state: NavigationHistoryState,
  location: NavigationLocation,
): NavigationHistoryState {
  const current = currentLocation(state);
  if (current && sameLocation(current, location)) return state;
  // Retargeting the tree while a document is open changes only the
  // notebook context, not the visible view. Updating the current entry
  // in place keeps Alt+Left to one press: without this, the context
  // change becomes a phantom step that back must step through invisibly
  // before reaching the previous view.
  if (current && current.tab === location.tab && isDocumentTab(location.tab)) {
    const entries = [...state.entries];
    entries[state.index] = location;
    return { entries, index: state.index };
  }
  const entries = [...state.entries.slice(0, state.index + 1), location];
  while (entries.length > NAVIGATION_HISTORY_LIMIT) entries.shift();
  return { entries, index: entries.length - 1 };
}

export function canGoBack(state: NavigationHistoryState): boolean {
  return state.index > 0;
}

export function canGoForward(state: NavigationHistoryState): boolean {
  return state.index >= 0 && state.index < state.entries.length - 1;
}

export function goBack(state: NavigationHistoryState): {
  state: NavigationHistoryState;
  location?: NavigationLocation;
} {
  if (!canGoBack(state)) return { state };
  const index = state.index - 1;
  return { state: { entries: state.entries, index }, location: state.entries[index] };
}

export function goForward(state: NavigationHistoryState): {
  state: NavigationHistoryState;
  location?: NavigationLocation;
} {
  if (!canGoForward(state)) return { state };
  const index = state.index + 1;
  return { state: { entries: state.entries, index }, location: state.entries[index] };
}
