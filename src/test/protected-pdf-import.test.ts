// @vitest-environment node
/**
 * Protected-PDF import (Tristen, 1.9.19 retest): permission-protected
 * and password-protected PDFs import as read-only managed documents
 * instead of being refused at import.
 *
 * Fixtures are real encrypted PDFs, generated with pdf-lib (one page,
 * readable text, one required text field with the tooltip "Your full
 * name") and encrypted with pypdf (pdf-lib cannot encrypt):
 * - permission-protected.pdf: no user password, owner password set,
 *   only form filling allowed — it opens without a password, but
 *   getPermissions() is non-null, which is what import used to refuse.
 * - password-protected.pdf: user password "test123" — the reader asks
 *   for it once at open.
 * Unlike document-workflows-backend.test.ts, nothing here mocks
 * pdf.js: these tests drive the real pinned build, so a password or
 * permission regression fails loudly instead of passing against a stub.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readImport, readImportSource, validatePdfImport } from '../../electron/vault/import';
import { createVaultService } from '../../electron/vault/service';
import { untaggedReport } from './fixtures/pdf-fixtures';
import { PdfDocument } from '../renderer/pdf-semantic/pdf-document';

const fixtures = path.resolve(__dirname, 'fixtures');
const permissionBytes = () => readFile(path.join(fixtures, 'permission-protected.pdf'));
const passwordBytes = () => readFile(path.join(fixtures, 'password-protected.pdf'));

let root = '';
const services: ReturnType<typeof createVaultService>[] = [];
beforeEach(async () => {
  root = path.resolve(`.test-protected-pdf-${randomUUID()}`);
  await mkdir(root);
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await rm(root, { recursive: true, force: true });
});

describe('protected PDF import', () => {
  it('reports an unprotected PDF as neither password- nor permission-protected', async () => {
    const info = await validatePdfImport(Buffer.from(untaggedReport(1)));
    expect(info).toMatchObject({ fillable: false, passwordProtected: false, permissionProtected: false });
  });

  it('reports a permission-protected PDF as fillable and permission-protected, not password-protected', async () => {
    const info = await validatePdfImport(Buffer.from(await permissionBytes()));
    expect(info.passwordProtected).toBe(false);
    expect(info.permissionProtected).toBe(true);
    // The field survives encryption: pdf.js still exposes the widget.
    expect(info.fillable).toBe(true);
    expect(info.fieldCount).toBeGreaterThan(0);
  });

  it('reports a password-protected PDF as password-protected, not permission-protected', async () => {
    const info = await validatePdfImport(Buffer.from(await passwordBytes()));
    expect(info).toMatchObject({ fillable: false, fieldCount: 0, passwordProtected: true, permissionProtected: false });
  });

  it('imports both protected kinds through readImportSource, bytes unchanged', async () => {
    for (const [name, bytes] of [
      ['permission-protected.pdf', await permissionBytes()],
      ['password-protected.pdf', await passwordBytes()],
    ] as const) {
      const source = path.join(root, name);
      await writeFile(source, bytes);
      expect(await readImportSource(source)).toEqual(bytes);
    }
  });

  it('imports both protected kinds through readImport, keeping the .pdf extension', async () => {
    for (const [name, bytes] of [
      ['permission-protected.pdf', await permissionBytes()],
      ['password-protected.pdf', await passwordBytes()],
    ] as const) {
      const source = path.join(root, name);
      await writeFile(source, bytes);
      const imported = await readImport(source, () => undefined);
      expect(imported.extension).toBe('.pdf');
      expect(imported.bytes).toEqual(bytes);
    }
  });

  it('imports both protected kinds into a library as managed copies', async () => {
    const service = createVaultService(root);
    services.push(service);
    await service.initialize();
    await mkdir(path.join(root, 'incoming'));
    for (const [name, bytes] of [
      ['permission-protected.pdf', await permissionBytes()],
      ['password-protected.pdf', await passwordBytes()],
    ] as const) {
      const source = path.join(root, 'incoming', name);
      await writeFile(source, bytes);
      const view = await service.importFile(source, '');
      expect(view.entries.find((entry) => entry.path === name)?.kind).toBe('attachment');
      expect(await readFile(path.join(root, name))).toEqual(bytes);
    }
  });

  it('reads a permission-protected PDF in the reader, with its field, and flags it protected', async () => {
    const bytes = new Uint8Array(await permissionBytes());
    const document = new PdfDocument(bytes, 'permission-hash', 'Reports/permission-protected.pdf');
    try {
      await document.ready;
      expect(document.permissionProtected).toBe(true);
      const page = await document.getPage(1);
      expect(page.textModel.fullText).toContain('Protected import fixture');
      expect(await document.getFormFields()).toMatchObject([
        { name: 'fullName', type: 'text', label: 'Your full name', required: true },
      ]);
    } finally {
      await document.destroy();
    }
  });

  it('asks for the password for a password-protected PDF, then reads it once unlocked', async () => {
    const locked = new PdfDocument(new Uint8Array(await passwordBytes()), 'password-hash', 'Reports/password.pdf');
    await expect(locked.ready).rejects.toMatchObject({ name: 'PasswordException' });
    await locked.destroy();
    const unlocked = new PdfDocument(
      new Uint8Array(await passwordBytes()),
      'password-hash',
      'Reports/password.pdf',
      undefined,
      {
        password: 'test123',
      },
    );
    try {
      await unlocked.ready;
      expect((await unlocked.getPage(1)).textModel.fullText).toContain('Protected import fixture');
    } finally {
      await unlocked.destroy();
    }
  });
});
