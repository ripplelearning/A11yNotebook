import DOMPurify from 'dompurify';
import { useState } from 'react';
import { imageUrl, parseCsv, type AttachmentPreview } from '../../../shared/attachments';
import { isAudioPath } from '../../../shared/audio';
import PlainTextDocument from '../vault/PlainTextDocument';
import DocumentReader from './DocumentReader';

interface Props {
  preview: AttachmentPreview;
  alt: string;
  onSaveAlt: (alt: string) => Promise<void>;
  onExternal: () => void;
  announce: (message: string) => void;
  /** Transcribe this audio file; absent when the preview is not audio. */
  onTranscribe?: () => void;
  /** True while a transcription of this audio file is running. */
  transcribing?: boolean;
  /** Path of the transcript note for this audio file, when one exists. */
  transcriptPath?: string | null;
  /** Open the transcript note; used with transcriptPath. */
  onOpenTranscript?: () => void;
}

export default function AttachmentView({
  preview,
  alt,
  onSaveAlt,
  onExternal,
  announce,
  onTranscribe,
  transcribing,
  transcriptPath,
  onOpenTranscript,
}: Props) {
  const [description, setDescription] = useState(alt);
  const image = /\.(?:png|jpe?g|gif|webp|bmp)$/i.test(preview.path);
  const audio = isAudioPath(preview.path);
  let rows: string[][] = [];
  let csvError = '';
  if (preview.kind === '.csv') {
    try {
      rows = parseCsv(preview.text);
    } catch {
      csvError = 'This CSV could not be parsed. Open it externally to inspect it.';
    }
  }
  const html =
    /\.html?$/i.test(preview.path) || preview.kind === '.html'
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
    <section
      aria-label="Attachment preview"
      data-context={/\.(?:pdf|epub|docx)$/i.test(preview.path) ? 'document-preview' : 'attachment'}
      data-path={preview.path}
      tabIndex={-1}
    >
      <h2>{preview.path.split('/').at(-1)}</h2>
      <button type="button" onClick={onExternal}>
        Open in external app
      </button>
      {audio ? (
        <>
          <audio controls src={imageUrl(preview.path)} aria-label={`Audio: ${preview.path.split('/').at(-1)}`} />
          {onTranscribe ? (
            <button type="button" disabled={transcribing} onClick={onTranscribe}>
              {transcribing ? 'Transcribing…' : 'Transcribe'}
            </button>
          ) : null}
          {transcriptPath && onOpenTranscript ? (
            <p>
              A transcript exists:{' '}
              <button type="button" onClick={onOpenTranscript}>
                Open transcript
              </button>
            </p>
          ) : null}
        </>
      ) : image ? (
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
        <DocumentReader key={preview.path} path={preview.path} kind=".pdf" />
      ) : preview.kind === '.epub' ? (
        <DocumentReader key={preview.path} path={preview.path} kind=".epub" />
      ) : preview.kind === '.docx' ? (
        <DocumentReader key={preview.path} path={preview.path} kind=".docx" />
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
        <div className="document-body">
          <PlainTextDocument text={preview.text} />
        </div>
      )}
    </section>
  );
}
