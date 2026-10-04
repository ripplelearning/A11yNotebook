import { describe, expect, it } from 'vitest';
import { planLinkRepair } from '../../electron/vault/link-repair';

describe('rename and move link repair', () => {
  it('repairs wiki aliases, encoded relative links, and outgoing links of a moved note', () => {
    const notes = [
      { path: 'A/Topic.md', content: '[Other](../Other.md#heading)' },
      { path: 'Other.md', content: '[[Topic|label]] [topic](A/Topic.md "title")' },
    ];
    const plan = planLinkRepair(notes, 'A/Topic.md', 'B/New topic.md');
    expect(plan.find((item) => item.path === 'Other.md')?.after).toBe(
      '[[B/New topic|label]] [topic](B/New%20topic.md "title")',
    );
    expect(plan.some((item) => item.path === 'A/Topic.md')).toBe(false);
  });

  it('adjusts outgoing relative links when moving into a deeper folder', () => {
    const plan = planLinkRepair(
      [
        { path: 'A.md', content: '[B](B.md)' },
        { path: 'B.md', content: '' },
      ],
      'A.md',
      'Folder/A.md',
    );
    expect(plan[0].after).toBe('[B](../B.md)');
  });

  it('ignores code, external URLs, and ambiguous title references', () => {
    const content = '[[Same]] `[[One]]`\n```\n[[One]]\n```\n[x](https://example.org/One.md)';
    expect(
      planLinkRepair(
        [
          { path: 'One.md', content: '' },
          { path: 'Same.md', content: '' },
          { path: 'A/Same.md', content: '' },
          { path: 'Ref.md', content },
        ],
        'One.md',
        'Two.md',
      ),
    ).toEqual([]);
  });

  it('repairs references to every note under a moved notebook', () => {
    expect(
      planLinkRepair(
        [
          { path: 'Old/N.md', content: '' },
          { path: 'Ref.md', content: '[[Old/N]] [N](Old/N.md#part)' },
        ],
        'Old',
        'New',
      )[0].after,
    ).toBe('[[New/N]] [N](New/N.md#part)');
  });
});
