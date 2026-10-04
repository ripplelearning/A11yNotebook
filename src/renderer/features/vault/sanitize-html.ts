import DOMPurify from 'dompurify';
import { imageUrl } from '../../../shared/attachments';

const SAFE_IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|bmp)$/i;

export function sanitizeNoteHtml(content: string, notePath = '') {
  const clean = DOMPurify.sanitize(content, {
    ADD_URI_SAFE_ATTR: [],
    ALLOWED_URI_REGEXP: /^(?:(?:vault-file|https?|mailto):|#|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    FORBID_ATTR: ['style', 'srcset', 'action', 'poster', 'background'],
    FORBID_TAGS: [
      'script',
      'style',
      'iframe',
      'object',
      'embed',
      'form',
      'button',
      'link',
      'meta',
      'base',
      'svg',
      'math',
    ],
  });
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
