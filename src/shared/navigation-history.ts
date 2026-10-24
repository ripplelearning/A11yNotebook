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
