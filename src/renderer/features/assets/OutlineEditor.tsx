import { serializeOutline, type OutlineNode } from '../../../shared/assets';
import TreeEditor from './TreeEditor';

export interface OutlineEditorProps {
  value: OutlineNode[];
  onChange: (value: OutlineNode[]) => void;
  onSave?: (markdown: string) => void;
  readOnly?: boolean;
}

export default function OutlineEditor({ value, onChange, onSave, readOnly }: OutlineEditorProps) {
  return (
    <div>
      <TreeEditor value={value} onChange={onChange} label="Outline" readOnly={readOnly} />
      {onSave && !readOnly && (
        <button type="button" onClick={() => onSave(serializeOutline(value))}>
          Save outline
        </button>
      )}
    </div>
  );
}
