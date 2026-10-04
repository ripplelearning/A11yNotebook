import DOMPurify from 'dompurify';
import { useEffect, useState } from 'react';
import { imageUrl, parseCsv, type AttachmentPreview } from '../../../shared/attachments';

interface Props {
  preview: AttachmentPreview;
  alt: string;
  onSaveAlt: (alt: string) => Promise<void>;
  onExternal: () => void;
  announce: (message: string) => void;
}

export default function AttachmentView({ preview, alt, onSaveAlt, onExternal, announce }: Props) {
  const [description, setDescription] = useState(alt);
  const [pageIndex, setPageIndex] = useState(0);
  const pages = preview.pages?.length ? preview.pages : [preview.text];
  useEffect(() => setPageIndex(0), [preview.path]);
  const image = /\.(?:png|jpe?g|gif|webp|bmp)$/i.test(preview.path);
  let rows: string[][] = [];
  let csvError = '';
  if (preview.kind === '.csv') {
    try {
      rows = parseCsv(preview.text);
    } catch {
      csvError = 'This CSV could not be parsed. Open it externally to inspect it.';
    }
  }
  const html = /\.html?$/i.test(preview.path)
    ? DOMPurify.sanitize(preview.text, {
        FORBID_TAGS: [
          'script',
          'style',
          'iframe',
          'object',
          'embed',
          'form',
          'input',
          'button',
          'link',
          'meta',
          'base',
          'svg',
          'math',
        ],
        FORBID_ATTR: ['src', 'srcset', 'href', 'style', 'action', 'poster', 'background'],
      })
    : '';
  return (
    <section aria-label="Attachment preview">
      <h2>{preview.path.split('/').at(-1)}</h2>
      <button type="button" onClick={onExternal}>
        Open in external app
      </button>
      {image ? (
        <>
          <img src={imageUrl(preview.path)} alt={alt || `Image: ${preview.path}`} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onSaveAlt(description)
                .then(() => announce('Image description saved.'))
                .catch(() => announce('Could not save image description.'));
            }}
          >
            <label>
              Image description (alternative text)
              <input maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <button type="submit">Save image description</button>
          </form>
        </>
      ) : html ? (
        <iframe
          title={`HTML preview: ${preview.path}`}
          sandbox=""
          srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; form-action 'none'; base-uri 'none'">${html}`}
        />
      ) : preview.kind === '.pdf' ? (
        <>
          <iframe title={`PDF preview: ${preview.path}`} sandbox="" src={imageUrl(preview.path)} />
          <section aria-label="Extracted PDF text">
            <h3>
              Page {pageIndex + 1} of {pages.length}
            </h3>
            <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((page) => page - 1)}>
              Previous page
            </button>
            <button
              type="button"
              disabled={pageIndex >= pages.length - 1}
              onClick={() => setPageIndex((page) => Math.min(pages.length - 1, page + 1))}
            >
              Next page
            </button>
            <pre>{pages[pageIndex] || 'No extractable text was found on this page.'}</pre>
          </section>
        </>
      ) : preview.kind === '.epub' ? (
        <section aria-label="ePub book content">
          <h3>
            Section {pageIndex + 1} of {pages.length}
          </h3>
          <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((page) => page - 1)}>
            Previous section
          </button>
          <button
            type="button"
            disabled={pageIndex >= pages.length - 1}
            onClick={() => setPageIndex((page) => Math.min(pages.length - 1, page + 1))}
          >
            Next section
          </button>
          <pre>{pages[pageIndex]}</pre>
        </section>
      ) : preview.kind === '.csv' ? (
        csvError ? (
          <p>{csvError}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <caption>{preview.path}</caption>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, column) =>
                      index === 0 ? (
                        <th scope="col" key={column}>
                          {cell || `Column ${column + 1}`}
                        </th>
                      ) : (
                        <td key={column}>{cell}</td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <pre>{preview.text}</pre>
      )}
    </section>
  );
}
