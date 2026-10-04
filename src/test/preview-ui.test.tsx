import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AttachmentView from '../renderer/features/previews/AttachmentView';
import MarkdownDocument from '../renderer/features/vault/MarkdownDocument';
import { relativeReference } from '../renderer/features/editor/InsertAttachmentDialog';
import WebCaptureDialog from '../renderer/features/previews/WebCaptureDialog';

describe('safe preview rendering and image insertion', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('removes active HTML and external resources and adds a sandbox policy', () => {
    render(
      <AttachmentView
        preview={{
          path: 'Page.html',
          kind: '.html',
          text: '<script>alert(1)</script><form><input></form><img src="https://example.org/x" onerror="alert(1)"><a href="https://example.org">Link</a><h1>Heading</h1>',
        }}
        alt=""
        onSaveAlt={vi.fn()}
        onExternal={vi.fn()}
        announce={vi.fn()}
      />,
    );
    const frame = screen.getByTitle('HTML preview: Page.html');
    expect(frame).toHaveAttribute('sandbox', '');
    const source = frame.getAttribute('srcdoc')!;
    expect(source).toContain("default-src 'none'");
    expect(source).toContain('<h1>Heading</h1>');
    expect(source).not.toContain('<script');
    expect(source).not.toContain('https://example.org');
    expect(source).not.toContain('<form');
    expect(source).not.toContain('onerror');
  });
  it('rewrites only local raster Markdown images to the validated protocol', () => {
    render(
      <MarkdownDocument
        content="![Diagram](../Images/My%20image.png)\n\n![Remote](https://example.org/image.png)"
        notePath="Notes/N.md"
        mode="read-only"
        links={[]}
        onChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByAltText('Diagram')).toHaveAttribute('src', 'vault-file://attachment/Images/My%20image.png');
    expect(screen.getByAltText('Remote')).not.toHaveAttribute('src', 'https://example.org/image.png');
    expect(relativeReference('Notes/N.md', 'Images/My image.png')).toBe('../Images/My%20image.png');
  });
  it('provides a labelled capture format selector and sends the selected format', async () => {
    const onCapture = vi.fn(async () => undefined);
    render(<WebCaptureDialog notebooks={[]} onCapture={onCapture} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('HTTPS page URL'), { target: { value: 'https://example.org/' } });
    fireEvent.change(screen.getByLabelText('Output format'), { target: { value: 'html' } });
    fireEvent.click(screen.getByRole('button', { name: 'Capture page' }));
    await waitFor(() => expect(onCapture).toHaveBeenCalledWith('https://example.org/', '', 'html'));
  });
  it('routes PDF previews into the local accessible reader', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    render(
      <AttachmentView
        preview={{ path: 'Docs/Guide.pdf', kind: '.pdf', text: 'First\n\nSecond', pages: ['First', 'Second'] }}
        alt=""
        onSaveAlt={vi.fn()}
        onExternal={vi.fn()}
        announce={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading pdf document…')).toBeInTheDocument();
  });
  it('routes ePub previews into the local accessible reader', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    render(
      <AttachmentView
        preview={{ path: 'Books/Guide.epub', kind: '.epub', text: 'Start\n\nEnd', pages: ['Start', 'End'] }}
        alt=""
        onSaveAlt={vi.fn()}
        onExternal={vi.fn()}
        announce={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading epub document…')).toBeInTheDocument();
  });
});
