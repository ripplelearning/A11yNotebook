import { serializeMindMap, serializeOutline, type OutlineNode } from '../../../shared/assets';
import TreeEditor from './TreeEditor';

export interface MindMapEditorProps {
  value: OutlineNode;
  onChange: (value: OutlineNode) => void;
  onSave?: (json: string) => void;
  onExportOutline?: (markdown: string) => void;
  readOnly?: boolean;
}

export default function MindMapEditor({ value, onChange, onSave, onExportOutline, readOnly }: MindMapEditorProps) {
  const nodes: { node: OutlineNode; depth: number; parent?: number }[] = [];
  const collect = (node: OutlineNode, depth: number, parent?: number) => {
    const index = nodes.length;
    nodes.push({ node, depth, parent });
    node.children.forEach((child) => collect(child, depth + 1, index));
  };
  collect(value, 0);
  return (
    <div>
      <TreeEditor
        value={[value]}
        onChange={(roots) => onChange(roots[0])}
        label="Mind map"
        singleRoot
        readOnly={readOnly}
      />
      <svg
        aria-hidden="true"
        focusable="false"
        width="100%"
        height={Math.max(80, nodes.length * 40)}
        viewBox={`0 0 ${Math.max(400, ...nodes.map(({ depth }) => depth * 160 + 200))} ${Math.max(80, nodes.length * 40)}`}
      >
        {nodes.map(({ node, depth, parent }, index) => (
          <g key={node.id}>
            {parent !== undefined && (
              <line
                x1={nodes[parent].depth * 160 + 20}
                y1={parent * 40 + 25}
                x2={depth * 160 + 20}
                y2={index * 40 + 25}
                stroke="currentColor"
              />
            )}
            <text x={depth * 160 + 24} y={index * 40 + 25} fill="currentColor">
              {node.text.slice(0, 24)}
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
