import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MarkdownDocument from '../renderer/features/vault/MarkdownDocument';

function renderReading(
  content: string,
  options: {
    format?: 'markdown' | 'html';
    values?: string[];
    onTemplateFieldChange?: (index: number, value: string) => void;
  } = {},
) {
  render(
    <MarkdownDocument
      content={content}
      mode="read-only"
      format={options.format ?? 'markdown'}
      links={[]}
      onChange={vi.fn()}
      onNavigate={() => undefined}
      templateFieldValues={options.values ?? []}
      onTemplateFieldChange={options.onTemplateFieldChange}
    />,
  );
}

describe('template fields in reading view', () => {
  it('renders an unknown placeholder as a textbox named for the field', () => {
    renderReading('Client: {{Client Name}}', { onTemplateFieldChange: vi.fn() });
    const field = screen.getByRole('textbox', { name: 'Client Name' }) as HTMLInputElement;
    expect(field).toBeEnabled();
    expect(field.value).toBe('');
    expect(document.body.textContent).not.toContain('{{Client Name}}');
  });

  it('leaves the six known placeholders as literal text', () => {
    renderReading('# {{title}}\n\nDate: {{date}} at {{time}} ({{weekday}}) in {{notebook}}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.body.textContent).toContain('{{title}}');
    expect(document.body.textContent).toContain('{{date}}');
  });

  it('numbers repeated field names and keeps them independent', () => {
    const onChange = vi.fn();
    renderReading('First: {{Client Name}}\nSecond: {{Client Name}}', { onTemplateFieldChange: onChange });
    const first = screen.getByRole('textbox', { name: 'Client Name 1' }) as HTMLInputElement;
    const second = screen.getByRole('textbox', { name: 'Client Name 2' }) as HTMLInputElement;
    expect(first).not.toBe(second);
    fireEvent.input(first, { target: { value: 'Ada' } });
    expect(onChange).toHaveBeenCalledWith(0, 'Ada');
    fireEvent.input(second, { target: { value: 'Grace' } });
    expect(onChange).toHaveBeenCalledWith(1, 'Grace');
  });

  it('shows a supplied value in the textbox', () => {
    renderReading('Client: {{Client Name}}', { values: ['Ada Lovelace'] });
    expect((screen.getByRole('textbox', { name: 'Client Name' }) as HTMLInputElement).value).toBe('Ada Lovelace');
  });

  it('renders a typo of a known placeholder as a field', () => {
    renderReading('Date: {{dat}}', { onTemplateFieldChange: vi.fn() });
    expect(screen.getByRole('textbox', { name: 'dat' })).toBeEnabled();
  });

  it('leaves markers inside fenced code and inline code as literal text', () => {
    renderReading('Fill {{Real}} in.\n\n```\n{{Code Example}}\n```\n\nAlso `{{Inline}}` stays.', {
      onTemplateFieldChange: vi.fn(),
    });
    expect(screen.getByRole('textbox', { name: 'Real' })).toBeEnabled();
    expect(screen.queryByRole('textbox', { name: 'Code Example' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Inline' })).toBeNull();
    expect(document.body.textContent).toContain('{{Code Example}}');
  });

  it('renders fields in HTML notes too', () => {
    renderReading('<p>Name: {{Client Name}}</p>', { format: 'html', onTemplateFieldChange: vi.fn() });
    expect(screen.getByRole('textbox', { name: 'Client Name' })).toBeEnabled();
  });

  it('renders disabled field inputs when no change handler is provided', () => {
    renderReading('Client: {{Client Name}}', { onTemplateFieldChange: undefined });
    expect((screen.getByRole('textbox', { name: 'Client Name' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('does not render fields in editing mode', () => {
    render(
      <MarkdownDocument
        content="Client: {{Client Name}}"
        mode="edit"
        format="markdown"
        links={[]}
        onChange={vi.fn()}
        onNavigate={() => undefined}
        templateFieldValues={[]}
        onTemplateFieldChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('textbox', { name: 'Client Name' })).toBeNull();
  });
});
