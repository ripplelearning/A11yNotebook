import { useId } from 'react';
import type { VaultTask } from '../../../shared/types';

export function summarizeNotebookTasks(tasks: VaultTask[]) {
  const groups = new Map<string, { notebook: string; total: number; complete: number }>();
  for (const task of tasks) {
    const segments = task.path.split(/[\\/]/);
    const notebook = segments.length > 1 ? segments.slice(0, -1).join('/') : 'Unfiled notes';
    const group = groups.get(notebook) ?? { notebook, total: 0, complete: 0 };
    group.total += 1;
    if (task.complete) group.complete += 1;
    groups.set(notebook, group);
  }
  return [...groups.values()].sort((a, b) => a.notebook.localeCompare(b.notebook));
}

export default function TaskProgressSummaries({ tasks }: { tasks: VaultTask[] }) {
  const id = useId();
  const summaries = summarizeNotebookTasks(tasks);
  return (
    <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Notebook task progress</h2>
      {summaries.length ? (
        <ul>{summaries.map(({ notebook, total, complete }) => (
          <li key={notebook}>
            <span>{notebook}: {complete} of {total} tasks complete</span>
            <progress aria-label={`${notebook} task progress`} value={complete} max={total} />
          </li>
        ))}</ul>
      ) : <p>No tasks.</p>}
    </section>
  );
}
