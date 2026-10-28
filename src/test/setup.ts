import '@testing-library/jest-dom/vitest';

// The guided tour auto-shows on a fresh install or a new version. Tests
// render the app without tutorial state, so suppress it here; the
// tutorial's own tests control localStorage explicitly. Node-environment
// test files have no window, so the seed must be guarded.
if (typeof window !== 'undefined') {
  window.localStorage.setItem('a11y-notebook.tutorial', JSON.stringify({ suppressed: true, lastVersionSeen: '' }));
}
