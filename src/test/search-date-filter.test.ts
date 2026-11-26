// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeSearchDateFilters } from '../shared/search';
import { validateSearchQuery } from '../../electron/vault/search';

/**
 * The search date filters are typed as MM/DD/YYYY; the query validator
 * only accepts YYYY-MM-DD. Before this conversion, a typed date made
 * the whole search fail validation, so no results displayed at all
 * (1.9.23 retest, item 6) — and the filter persisted, so every later
 * search failed too until the filters were cleared.
 */
describe('normalizeSearchDateFilters', () => {
  it('converts a typed MM/DD/YYYY date to the YYYY-MM-DD the query requires', () => {
    expect(normalizeSearchDateFilters({ modifiedAfter: '11/10/2026' })).toEqual({
      modifiedAfter: '2026-11-10',
      modifiedBefore: undefined,
    });
    expect(normalizeSearchDateFilters({ modifiedBefore: '01/05/2026' })).toEqual({
      modifiedAfter: undefined,
      modifiedBefore: '2026-01-05',
    });
  });

  it('passes an already-ISO date through unchanged', () => {
    expect(normalizeSearchDateFilters({ modifiedAfter: '2026-11-10' })).toEqual({
      modifiedAfter: '2026-11-10',
      modifiedBefore: undefined,
    });
  });

  it('drops a half-typed date instead of failing the search', () => {
    expect(normalizeSearchDateFilters({ modifiedAfter: '11/1' })).toEqual({
      modifiedAfter: undefined,
      modifiedBefore: undefined,
    });
  });

  it('drops an impossible date instead of failing the search', () => {
    expect(normalizeSearchDateFilters({ modifiedAfter: '02/30/2026' })).toEqual({
      modifiedAfter: undefined,
      modifiedBefore: undefined,
    });
  });

  it('drops both dates when the range is reversed', () => {
    expect(
      normalizeSearchDateFilters({ modifiedAfter: '12/01/2026', modifiedBefore: '01/01/2026' }),
    ).toEqual({});
  });

  it('keeps the other filters untouched', () => {
    expect(
      normalizeSearchDateFilters({ kind: 'note', tag: 'review', modifiedAfter: '11/10/2026' }),
    ).toEqual({
      kind: 'note',
      tag: 'review',
      modifiedAfter: '2026-11-10',
      modifiedBefore: undefined,
    });
  });

  it('produces a query the validator accepts', () => {
    const filters = normalizeSearchDateFilters({
      modifiedAfter: '11/10/2026',
      modifiedBefore: '11/25/2026',
    });
    expect(() => validateSearchQuery({ text: 'review', ...filters, limit: 100 })).not.toThrow();
    expect(validateSearchQuery({ text: 'review', ...filters, limit: 100 })).toEqual({
      text: 'review',
      modifiedAfter: '2026-11-10',
      modifiedBefore: '2026-11-25',
      limit: 100,
    });
  });
});
