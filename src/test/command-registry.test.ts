import { describe, expect, it } from 'vitest';
import { cycleFocusRegions, dispatchCommand, getCommandById } from '../shared/command-registry';

describe('command registry', () => {
  it('returns a command definition by id', () => {
    expect(getCommandById('toggle-read-only-mode')?.label).toBe('Toggle read-only/edit mode');
  });

  it('dispatches read-only mode toggles', () => {
    let currentMode = 'read-only';
    const result = dispatchCommand('toggle-read-only-mode', {
      mode: currentMode,
      rightPaneOpen: true,
      setMode: (value) => {
        currentMode = value;
      },
      setRightPaneOpen: () => undefined,
      setStatusMessage: () => undefined,
      setCommandPaletteOpen: () => undefined,
      setSelectedTab: () => undefined,
    });

    expect(result).toBe('Mode switched to edit.');
    expect(currentMode).toBe('edit');
  });
});

describe('focus region cycling', () => {
  it('moves forward through the main focus regions', () => {
    expect(cycleFocusRegions('navigation', 'forward')).toBe('main');
    expect(cycleFocusRegions('status', 'forward')).toBe('navigation');
  });

  it('moves backward through the main focus regions', () => {
    expect(cycleFocusRegions('navigation', 'backward')).toBe('status');
    expect(cycleFocusRegions('main', 'backward')).toBe('navigation');
  });
});
