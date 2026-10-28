import '@testing-library/jest-dom/vitest';

// The guided tour auto-shows on a fresh install or a new version. Tests
// render the app without tutorial state, so suppress it here; the
// tutorial's own tests control localStorage explicitly.
window.localStorage.setItem('a11y-notebook.tutorial', JSON.stringify({ suppressed: true, lastVersionSeen: '' }));
