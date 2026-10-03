import { useEffect, useRef, useState } from 'react';
import type { OutlineNode } from '../../../shared/assets';

export interface TreeEditorProps {
  value: OutlineNode[];
  onChange: (value: OutlineNode[]) => void;
  label: string;
  readOnly?: boolean;
  singleRoot?: boolean;
}

function mapTree(nodes: OutlineNode[], id: string, change: (node: OutlineNode) => OutlineNode): OutlineNode[] {
  return nodes.map((node) =>
    node.id === id ? change(node) : { ...node, children: mapTree(node.children, id, change) },
  );
}

function removeNode(nodes: OutlineNode[], id: string): OutlineNode[] {
  return nodes.filter((node) => node.id !== id).map((node) => ({ ...node, children: removeNode(node.children, id) }));
}

export default function TreeEditor({ value, onChange, label, readOnly = false, singleRoot = false }: TreeEditorProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>(value[0]?.id);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const refs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef(false);
  const all: { node: OutlineNode; parent?: OutlineNode; siblings: OutlineNode[] }[] = [];
  const visible: OutlineNode[] = [];
  const collect = (nodes: OutlineNode[], parent?: OutlineNode, hidden = false) => {
    for (const node of nodes) {
      all.push({ node, parent, siblings: nodes });
      if (!hidden) visible.push(node);
      collect(node.children, node, hidden || collapsed.has(node.id));
    }
  };
  collect(value);
  const selected = all.find(({ node }) => node.id === selectedId) ?? all[0];
  const activeId = visible.some((node) => node.id === selected?.node.id) ? selected?.node.id : visible[0]?.id;
  useEffect(() => {
    if (pendingFocus.current) {
      refs.current.get(activeId ?? '')?.focus();
      pendingFocus.current = false;
    }
  }, [value, activeId]);
  const focus = (id: string | undefined) => {
    setSelectedId(id);
    if (id) refs.current.get(id)?.focus();
  };
  const toggle = (id: string, collapse: boolean) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (collapse) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const add = (child: boolean) => {
    const node: OutlineNode = { id: crypto.randomUUID(), text: 'New item', children: [] };
    let next: OutlineNode[];
    if (!selected) next = [node];
    else if (child) {
      next = mapTree(value, selected.node.id, (parent) => ({ ...parent, children: [...parent.children, node] }));
      toggle(selected.node.id, false);
    } else {
      const insert = (nodes: OutlineNode[]): OutlineNode[] =>
        nodes.flatMap((item) =>
          item.id === selected.node.id ? [item, node] : [{ ...item, children: insert(item.children) }],
        );
      next = insert(value);
    }
    setSelectedId(node.id);
    pendingFocus.current = true;
    onChange(next);
  };
  const reorder = (offset: number) => {
    if (!selected) return;
    const index = selected.siblings.indexOf(selected.node);
    const target = index + offset;
    if (target < 0 || target >= selected.siblings.length) return;
    const siblings = [...selected.siblings];
    [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
    onChange(
      selected.parent ? mapTree(value, selected.parent.id, (node) => ({ ...node, children: siblings })) : siblings,
    );
  };
  const indent = () => {
    if (!selected) return;
    const prior = selected.siblings[selected.siblings.indexOf(selected.node) - 1];
    if (!prior) return;
    toggle(prior.id, false);
    onChange(
      mapTree(removeNode(value, selected.node.id), prior.id, (node) => ({
        ...node,
        children: [...node.children, selected.node],
      })),
    );
  };
  const outdent = () => {
    if (!selected?.parent || (singleRoot && selected.parent.id === value[0]?.id)) return;
    const parentId = selected.parent.id;
    const insert = (nodes: OutlineNode[]): OutlineNode[] =>
      nodes.flatMap((node) =>
        node.id === parentId ? [node, selected.node] : [{ ...node, children: insert(node.children) }],
      );
    onChange(insert(removeNode(value, selected.node.id)));
  };
  const renderNodes = (nodes: OutlineNode[], level: number) =>
    nodes.map((node, index) => (
      <div
        role="treeitem"
        key={node.id}
        ref={(element) => {
          if (element) refs.current.set(node.id, element);
          else refs.current.delete(node.id);
        }}
        aria-label={node.text || 'Empty item'}
        aria-level={level}
        aria-posinset={index + 1}
        aria-setsize={nodes.length}
        aria-selected={activeId === node.id}
        aria-expanded={node.children.length ? !collapsed.has(node.id) : undefined}
        tabIndex={activeId === node.id ? 0 : -1}
        onFocus={(event) => {
          if (event.target === event.currentTarget) setSelectedId(node.id);
        }}
        onClick={(event) => {
          event.stopPropagation();
          focus(node.id);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const index = visible.indexOf(node);
          const parent = all.find((item) => item.node.id === node.id)?.parent;
          switch (event.key) {
            case 'ArrowDown':
              focus(visible[Math.min(visible.length - 1, index + 1)]?.id);
              break;
            case 'ArrowUp':
              focus(visible[Math.max(0, index - 1)]?.id);
              break;
            case 'Home':
              focus(visible[0]?.id);
              break;
            case 'End':
              focus(visible.at(-1)?.id);
              break;
            case 'ArrowRight':
              if (collapsed.has(node.id)) toggle(node.id, false);
              else if (node.children.length) focus(node.children[0].id);
              break;
            case 'ArrowLeft':
              if (node.children.length && !collapsed.has(node.id)) toggle(node.id, true);
              else focus(parent?.id);
              break;
            case 'Enter':
            case 'F2':
              if (!readOnly) editor.current?.focus();
              break;
            default:
              return;
          }
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <span>
          {node.children.length ? (collapsed.has(node.id) ? '▸ ' : '▾ ') : ''}
          {node.text || 'Empty item'}
        </span>
        {node.children.length > 0 && !collapsed.has(node.id) && (
          <div role="group" style={{ marginInlineStart: '1.5rem' }}>
            {renderNodes(node.children, level + 1)}
          </div>
        )}
      </div>
    ));
  const editor = useRef<HTMLTextAreaElement>(null);
  const index = selected ? selected.siblings.indexOf(selected.node) : -1;
  const rootSelected = singleRoot && selected?.node.id === value[0]?.id;
  return (
    <section aria-label={`${label} editor`}>
      <p>Use arrow keys to navigate, Right and Left to expand or collapse, and Enter to edit.</p>
      <div role="tree" aria-label={label}>
        {renderNodes(value, 1)}
      </div>
      {!value.length && <p>No items.</p>}
      {!readOnly && (
        <div>
          {selected && (
            <label>
              Item text
              <textarea
                ref={editor}
                value={selected.node.text}
                onChange={(event) =>
                  onChange(mapTree(value, selected.node.id, (node) => ({ ...node, text: event.target.value })))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    focus(activeId);
                  }
                }}
              />
            </label>
          )}
          <button type="button" onClick={() => add(false)} disabled={rootSelected}>
            Add item
          </button>
          <button type="button" onClick={() => add(true)} disabled={!selected}>
            Add child
          </button>
          <button
            type="button"
            disabled={!selected || rootSelected}
            onClick={() => {
              if (!selected) return;
              const next = removeNode(value, selected.node.id);
              setSelectedId(selected.parent?.id ?? next[0]?.id);
              pendingFocus.current = true;
              onChange(next);
            }}
          >
            Delete item
          </button>
          <button type="button" onClick={() => reorder(-1)} disabled={index <= 0}>
            Move up
          </button>
          <button
            type="button"
            onClick={() => reorder(1)}
            disabled={!selected || index >= selected.siblings.length - 1}
          >
            Move down
          </button>
          <button type="button" onClick={indent} disabled={index <= 0}>
            Indent item
          </button>
          <button
            type="button"
            onClick={outdent}
            disabled={!selected?.parent || (singleRoot && selected.parent.id === value[0]?.id)}
          >
            Outdent item
          </button>
        </div>
      )}
    </section>
  );
}
