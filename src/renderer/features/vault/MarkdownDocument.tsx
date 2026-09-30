// Renders notes as sanitized semantic Markdown or a native textarea for editing.
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });

interface MarkdownDocumentProps {
  content: string;
  mode: 'read-only' | 'edit';
  onChange: (content: string) => void;
}

/** Render safe browse-mode HTML or expose the unformatted Markdown source editor. */
export default function MarkdownDocument({ content, mode, onChange }: MarkdownDocumentProps) {
  if (mode === 'edit') {
    return (
      <label className="editor-label">
        Markdown source
        <textarea
          aria-label="Markdown source"
          className="markdown-editor"
          value={content}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }

  return (
    <div
      className="document-body markdown-body"
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(markdown.render(content)) }}
    />
  );
}
