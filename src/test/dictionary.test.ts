// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDictionaryDefinitions } from '../../electron/vault/dictionary';

afterEach(() => {
  vi.unstubAllGlobals();
});

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe('dictionary definitions fetch', () => {
  it('parses meanings and keeps at most three definitions per meaning', async () => {
    const fetchMock = vi.fn(async () => okJson([
      {
        word: 'glad',
        meanings: [
          {
            partOfSpeech: 'Adjective',
            definitions: [
              { definition: 'One.' },
              { definition: 'Two.', example: 'Two example.' },
              { definition: 'Three.' },
              { definition: 'Four.' },
            ],
          },
        ],
      },
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const meanings = await fetchDictionaryDefinitions('glad');
    expect(fetchMock).toHaveBeenCalledWith('https://api.dictionaryapi.dev/api/v2/entries/en/glad');
    expect(meanings).toEqual([
      {
        partOfSpeech: 'Adjective',
        definitions: [
          { definition: 'One.' },
          { definition: 'Two.', example: 'Two example.' },
          { definition: 'Three.' },
        ],
      },
    ]);
  });

  it('reports a missing word plainly on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    await expect(fetchDictionaryDefinitions('zzzqqq')).rejects.toThrow('No definitions found for “zzzqqq”.');
  });

  it('reports a network failure plainly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    await expect(fetchDictionaryDefinitions('glad')).rejects.toThrow('Could not reach the dictionary.');
  });

  it('reports empty meanings as no definitions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson([{ word: 'glad', meanings: [] }])));
    await expect(fetchDictionaryDefinitions('glad')).rejects.toThrow('No definitions found for “glad”.');
  });
});
