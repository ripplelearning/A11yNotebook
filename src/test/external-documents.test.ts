// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isExternalDocumentPath } from '../../electron/vault/external-documents';
import { isSupportedDocument } from '../../electron/vault/import';

describe('separate external application document formats', () => {
  it.each([
    'rtf',
    'doc',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'odt',
    'ods',
    'odp',
    'pages',
    'numbers',
    'key',
    'tsv',
    'markdown',
  ])('offers %s originals to OS applications without claiming an internal parser', (extension) => {
    expect(isExternalDocumentPath(`Folder/Original.${extension}`)).toBe(true);
    expect(isExternalDocumentPath(`Folder/Original.${extension.toUpperCase()}`)).toBe(true);
    expect(isSupportedDocument(`Original.${extension}`)).toBe(false);
  });
  it.each(['exe', 'com', 'scr', 'msi', 'bat', 'cmd', 'ps1', 'sh', 'vbs', 'js', 'hta', 'lnk', 'url', 'scf', 'desktop'])(
    'rejects executable, script, installer and shortcut .%s files',
    (extension) => {
      expect(isExternalDocumentPath(`File.${extension}`)).toBe(false);
      expect(isExternalDocumentPath(`File.docx.${extension}`)).toBe(false);
    },
  );
});
