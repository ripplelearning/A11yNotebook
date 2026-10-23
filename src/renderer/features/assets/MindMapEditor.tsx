import { useState } from 'react';
import { serializeMindMap, serializeOutline, type OutlineNode } from '../../../shared/assets';
import { layoutMindMap, MIND_MAP_FONT_SIZE, type MindMapLayoutKind } from '../../../shared/mind-map-layout';
import TreeEditor from './TreeEditor';

export interface MindMapEditorProps {
  value: OutlineNode;
  onChange: (value: OutlineNode) => void;
  onSave?: (json: string) => void;
  onExportOutline?: (markdown: string) => void;
  readOnly?: boolean;
}

const LAYOUT_STORAGE_KEY = 'a11y-notebook.mind-map-layout';

function storedLayout(): MindMapLayoutKind {
  try {
    return window.localStorage.getItem(LAYOUT_STORAGE_KEY) === 'radial' ? 'radial' : 'hierarchical';
  } catch {
    return 'hierarchical';
  }
}

const DEPTH_FILLS = ['0.22', '0.14', '0.09', '0.06', '0.04'];

function displayText(text: string, width: number): string {
  const maxChars = Math.max(4, Math.floor((width - 20) / 7.2));
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

export default function MindMapEditor({ value, onChange, onSave, onExportOutline, readOnly }: MindMapEditorProps) {
  const [layoutKind, setLayoutKind] = useState<MindMapLayoutKind>(storedLayout);
  const layout = layoutMindMap(value, layoutKind);
  const chooseLayout = (kind: MindMapLayoutKind) => {
    setLayoutKind(kind);
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, kind);
    } catch {
      // The choice simply will not persist.
    }
  };
  return (
    <div>
      <TreeEditor
        value={[value]}
        onChange={(roots) => onChange(roots[0])}
        label="Mind map"
        singleRoot
        readOnly={readOnly}
      />
      <fieldset>
        <legend>Map layout</legend>
        <label>
          <input
            type="radio"
            name="mind-map-layout"
            value="hierarchical"
            checked={layoutKind === 'hierarchical'}
            onChange={() => chooseLayout('hierarchical')}
          />{' '}
          Hierarchical
        </label>{' '}
        <label>
          <input
            type="radio"
            name="mind-map-layout"
            value="radial"
            checked={layoutKind === 'radial'}
            onChange={() => chooseLayout('radial')}
          />{' '}
          Radial
        </label>
      </fieldset>
      <svg
        aria-hidden="true"
        focusable="false"
        width="100%"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        data-layout={layoutKind}
        className="mind-map-visual"
      >
        {layout.nodes.map((node) =>
          node.parentId ? (
            <path
              key={`edge-${node.id}`}
              d={layout.connectors.get(node.id) ?? ''}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.55"
              strokeWidth={node.depth === 1 ? 2 : 1.25}
            />
          ) : null,
        )}
        {layout.nodes.map((node) => (
          <g key={node.id}>
            <title>{node.text}</title>
            <rect
              x={node.x - node.width / 2}
              y={node.y - node.height / 2}
              width={node.width}
              height={node.height}
              rx={node.depth === 0 ? 14 : 9}
              fill="currentColor"
              fillOpacity={DEPTH_FILLS[Math.min(node.depth, DEPTH_FILLS.length - 1)]}
              stroke="currentColor"
              strokeOpacity="0.7"
              strokeWidth={node.depth === 0 ? 2 : 1}
            />
            <text
              x={node.x}
              y={node.y}
              textAnchor="middle"
              dominantBaseline="central"
              fill="currentColor"
              fontSize={MIND_MAP_FONT_SIZE}
              fontWeight={node.depth === 0 ? 600 : 400}
            >
              {displayText(node.text, node.width)}
            </text>
          </g>
        ))}
      </svg>
      {onSave && !readOnly && (
        <button type="button" onClick={() => onSave(serializeMindMap(value))}>
          Save mind map
        </button>
      )}
      {onExportOutline && (
        <button type="button" onClick={() => onExportOutline(serializeOutline([value]))}>
          Export outline
        </button>
      )}
    </div>
  );
}
