import DOMPurify from 'dompurify';
import { imageUrl } from '../../../shared/attachments';
import { BIBLIOGRAPHY_HANGING_INDENT, isBibliographyStyle } from '../../../shared/citations';

const SAFE_IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|bmp)$/i;

export { BIBLIOGRAPHY_HANGING_INDENT };

/**
 * DOMPurify drops every inline style that is not part of a bibliography
 * block: only the bibliography declarations survive, so a pasted style
 * cannot hide content or restyle a note. The hook is registered for this
 * one call only, so other previews that sanitize with their own configs
 * are unaffected.
 */
function dropNonBibliographyStyles(
  _node: Element,
  data: { attrName: string; attrValue: string; keepAttr: boolean },
): void {
  if (data.attrName === 'style' && !isBibliographyStyle(data.attrValue)) {
    data.keepAttr = false;
  }
}

export function sanitizeNoteHtml(content: string, notePath = '') {
  DOMPurify.addHook('uponSanitizeAttribute', dropNonBibliographyStyles);
  let clean: string;
  try {
    clean = DOMPurify.sanitize(content, {
      ADD_ATTR: [
        'data-a11y-task-id',
        'data-a11y-task-complete',
        'data-a11y-task-due',
        'data-a11y-task-due-time',
        'data-a11y-task-priority',
        'data-a11y-task-remind',
        // MathML: keep the ASCII source so math survives editing and export.
        'alttext',
        'display',
      ],
      ADD_URI_SAFE_ATTR: [],
      ALLOWED_URI_REGEXP: /^(?:(?:vault-file|https?|mailto):|#|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    FORBID_ATTR: ['srcset', 'action', 'poster', 'background'],
    FORBID_TAGS: [
      'script',
      'style',
      'iframe',
      'object',
      'embed',
      'form',
      'button',
      'input',
      'select',
      'textarea',
      'option',
      'fieldset',
      'link',
      'meta',
      'base',
      'svg',
    ],
    });
  } finally {
    DOMPurify.removeHooks('uponSanitizeAttribute');
  }
  const documentFragment = document.createElement('template');
  documentFragment.innerHTML = clean;
  documentFragment.content.querySelectorAll('img').forEach((image) => {
    const alt = image.getAttribute('alt')?.trim();
    const source = image.getAttribute('src')?.trim() ?? '';
    if (!alt || !source) {
      image.remove();
      return;
    }
    if (/^vault-file:\/\/attachment\//i.test(source)) return;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(source) || !SAFE_IMAGE_EXTENSION.test(source.split(/[?#]/)[0])) {
      image.remove();
      return;
    }
    const parts = notePath.split('/').slice(0, -1).filter(Boolean);
    for (const part of source.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!parts.length) {
          image.remove();
          return;
        }
        parts.pop();
      } else parts.push(part);
    }
    image.setAttribute('src', imageUrl(parts.join('/')));
  });
  return documentFragment.innerHTML;
}
