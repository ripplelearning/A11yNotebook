import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MarkdownDocument from '../renderer/features/vault/MarkdownDocument';

function renderReading(
  content: string,
  options: {
    format?: 'markdown' | 'html';
    values?: string[];
    onTemplateFieldChange?: (index: number, value: string) => void;
    notePath?: string;
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
      notePath={options.notePath}
      templateFieldValues={options.values ?? []}
      onTemplateFieldChange={options.onTemplateFieldChange}
    />,
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function expectedDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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

  it('expands known placeholders as a preview in a template note', () => {
    renderReading('# {{title}}\n\nNotebook: {{notebook}}\nDate: {{date}} at {{time}} ({{weekday}})', {
      notePath: 'Templates/Intake.md',
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('Intake');
    expect(text).toContain('Notebook: Templates');
    expect(text).toContain(`Date: ${expectedDate()}`);
    expect(text).toContain(`(${WEEKDAYS[new Date().getDay()]})`);
    expect(text).toMatch(/\d{2}:\d{2}/);
    expect(text).not.toContain('{{title}}');
    expect(text).not.toContain('{{notebook}}');
    expect(text).not.toContain('{{date}}');
    expect(text).not.toContain('{{time}}');
    expect(text).not.toContain('{{weekday}}');
  });

  it('still renders unknown names as textboxes in a template note', () => {
    renderReading('# {{title}}\n\nClient: {{Client Name}}', {
      notePath: 'Templates/Intake.md',
      onTemplateFieldChange: vi.fn(),
    });
    expect(document.body.textContent).toContain('Intake');
    expect(document.body.textContent).not.toContain('{{title}}');
    expect(screen.getByRole('textbox', { name: 'Client Name' })).toBeEnabled();
  });

  it('expands known placeholders in a template note with no fillable fields', () => {
    renderReading('Date: {{date}}', { notePath: 'Templates/Daily.md' });
    expect(document.body.textContent).toContain(`Date: ${expectedDate()}`);
    expect(document.body.textContent).not.toContain('{{date}}');
  });

  it('renders the cursor placeholder as nothing in a template note', () => {
    renderReading('Start here:{{cursor}} done.', { notePath: 'Templates/Intake.md' });
    expect(document.body.textContent).toContain('Start here: done.');
    expect(document.body.textContent).not.toContain('{{cursor}}');
  });

  it('leaves known placeholders literal in a non-template note', () => {
    renderReading('# {{title}}\n\nDate: {{date}}', { notePath: 'Notes/Intake.md' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.body.textContent).toContain('{{title}}');
    expect(document.body.textContent).toContain('{{date}}');
  });

  it('expands known placeholders in an HTML template note', () => {
    renderReading('<h1>{{title}}</h1><p>Date: {{date}}</p>', {
      format: 'html',
      notePath: 'Templates/Intake.html',
    });
    expect(document.body.textContent).toContain('Intake');
    expect(document.body.textContent).toContain(`Date: ${expectedDate()}`);
    expect(document.body.textContent).not.toContain('{{title}}');
    expect(document.body.textContent).not.toContain('{{date}}');
  });

  it('shows raw known placeholders in editing mode for a template note', () => {
    render(
      <MarkdownDocument
        content="# {{title}}\n\nDate: {{date}}"
        mode="edit"
        format="markdown"
        links={[]}
        onChange={vi.fn()}
        onNavigate={() => undefined}
        notePath="Templates/Intake.md"
        templateFieldValues={[]}
        onTemplateFieldChange={vi.fn()}
      />,
    );
    expect(document.body.textContent).toContain('{{title}}');
    expect(document.body.textContent).toContain('{{date}}');
  });
});
