import { TEMPLATES_FOLDER, templateNotePath, type NoteTemplate } from './templates';
import type { VaultEntry, VaultInfo } from './types';

/**
 * Copying the built-in templates into a fresh library is a background
 * first-open task, and on a slow machine any single copy can fail
 * transiently: the library file the copy has to record can be locked
 * for a moment by another process, so the write is refused and the
 * whole copy reports as failed. The old loop aborted on the first
 * such failure, leaving the Templates folder empty, and wrote a
 * persistent error into the shared status line, where it sat until
 * the next status update and could be mistaken for a later result.
 *
 * This helper makes the copy robust instead: each missing template is
 * retried across passes with a short pause between them, a template
 * that is already there (an earlier copy landed, or the file existed
 * all along) counts as done without another create, and a template
 * that still fails after every pass never blocks the others. Failures
 * are logged for diagnosis and never written to the status line: the
 * copy retries on the next open, so a background failure is not a
 * message the user needs to act on.
 */

/** How many passes over the missing templates a seed attempt makes. */
export const TEMPLATE_SEED_ATTEMPTS = 3;

/** Pause before each retry pass, in milliseconds. */
export const TEMPLATE_SEED_RETRY_DELAYS_MS = [300, 700];

export interface TemplateSeedDeps {
  /** Creates one note; resolves with the fresh library view, like the app bridge. */
  createNote: (relativePath: string, content: string) => Promise<VaultInfo>;
  /** Returns a fresh library view, for checking whether a failed copy landed anyway. */
  getLibrary: () => Promise<VaultInfo>;
  /** False once the library changed or the user moved on: stop seeding quietly. */
  isCurrent: () => boolean;
  /** Pause helper; defaults to a real timer, injectable so tests run instantly. */
  delay?: (ms: number) => Promise<void>;
  /** Where a failed copy is recorded; defaults to the console error log. */
  logError?: (templateName: string, error: unknown) => void;
}

export interface TemplateSeedResult {
  /** True when every missing template is now in the library. */
  allSeeded: boolean;
  /** Names of the templates still missing after every pass. */
  failed: string[];
  /** Freshest library view seen during the run, if any copy succeeded. */
  latestLibrary: VaultInfo | null;
}

function flattenPaths(entries: VaultEntry[]): string[] {
  const paths: string[] = [];
  const walk = (items: VaultEntry[]) => {
    for (const entry of items) {
      paths.push(entry.path);
      if (entry.children) walk(entry.children);
    }
  };
  walk(entries);
  return paths;
}

export async function seedBuiltInTemplates(
  missing: NoteTemplate[],
  initialPaths: string[],
  deps: TemplateSeedDeps,
): Promise<TemplateSeedResult> {
  const delay =
    deps.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const logError =
    deps.logError ??
    ((templateName: string, error: unknown) => {
      console.error(`Template seeding failed for ${templateName}:`, error);
    });
  // Resolve the target path for each template up front: a name that
  // cannot become a file name counts as failed without blocking the rest.
  const targets: { template: NoteTemplate; relativePath: string | null }[] = missing.map((template) => {
    try {
      return {
        template,
        relativePath: templateNotePath(TEMPLATES_FOLDER, template.name, template.format ?? 'markdown'),
      };
    } catch (error) {
      logError(template.name, error);
      return { template, relativePath: null };
    }
  });
  let present = new Set(initialPaths);
  let latestLibrary: VaultInfo | null = null;
  let remaining = targets.filter((target) => target.relativePath !== null && !present.has(target.relativePath));
  const failed = targets
    .filter((target) => target.relativePath === null)
    .map((target) => target.template.name);

  for (let pass = 0; pass < TEMPLATE_SEED_ATTEMPTS && remaining.length > 0; pass++) {
    if (pass > 0) {
      if (!deps.isCurrent()) break;
      await delay(TEMPLATE_SEED_RETRY_DELAYS_MS[pass - 1] ?? 700);
      if (!deps.isCurrent()) break;
      // A copy that failed may have landed anyway — an existing file
      // reports as a failure to create — so refresh the view before
      // retrying and drop any template that is already there.
      try {
        const fresh = await deps.getLibrary();
        latestLibrary = fresh;
        present = new Set(flattenPaths(fresh.entries));
      } catch (error) {
        logError('(library refresh)', error);
      }
      remaining = remaining.filter((target) => target.relativePath !== null && !present.has(target.relativePath));
      if (remaining.length === 0) break;
    }
    const stillMissing: typeof remaining = [];
    for (let index = 0; index < remaining.length; index++) {
      const target = remaining[index];
      if (target.relativePath === null) continue;
      if (!deps.isCurrent()) {
        // The library changed mid-pass: stop quietly and leave the
        // unattempted templates for the next open.
        stillMissing.push(...remaining.slice(index));
        break;
      }
      try {
        const view = await deps.createNote(target.relativePath, target.template.content);
        latestLibrary = view;
        present = new Set(flattenPaths(view.entries));
      } catch (error) {
        logError(target.template.name, error);
        stillMissing.push(target);
      }
    }
    remaining = stillMissing.filter(
      (target) => target.relativePath !== null && !present.has(target.relativePath),
    );
  }

  return {
    allSeeded: remaining.length === 0,
    failed: [...failed, ...remaining.map((target) => target.template.name)],
    latestLibrary,
  };
}
