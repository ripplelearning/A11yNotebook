import { describe, expect, it } from 'vitest';
import { layoutMindMap, mindMapNodeWidth } from '../shared/mind-map-layout';
import type { OutlineNode } from '../shared/assets';

const tree: OutlineNode = {
  id: 'root',
  text: 'Main idea',
  children: [
    {
      id: 'a',
      text: 'Branch A',
      children: [
        { id: 'a1', text: 'Leaf A1', children: [] },
        { id: 'a2', text: 'Leaf A2', children: [] },
      ],
    },
    { id: 'b', text: 'Branch B', children: [{ id: 'b1', text: 'Leaf B1', children: [] }] },
    { id: 'c', text: 'Branch C', children: [] },
  ],
};

describe('mind map layouts', () => {
  it('sizes nodes from their text within bounds', () => {
    expect(mindMapNodeWidth('Hi')).toBeGreaterThanOrEqual(56);
    expect(mindMapNodeWidth('x'.repeat(200))).toBe(264);
  });

  it('hierarchical: parents center over their children and siblings never share a row band', () => {
    const layout = layoutMindMap(tree, 'hierarchical');
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const a = byId.get('a')!;
    const a1 = byId.get('a1')!;
    const a2 = byId.get('a2')!;
    expect(a.y).toBeCloseTo((a1.y + a2.y) / 2, 5);
    // Leaves occupy distinct vertical bands (no overlap).
    const leaves = layout.nodes.filter((node) => ['a1', 'a2', 'b1', 'c'].includes(node.id));
    const bands = leaves.map((node) => node.y).sort((x, y) => x - y);
    for (let index = 1; index < bands.length; index += 1) expect(bands[index] - bands[index - 1]).toBeGreaterThanOrEqual(44);
    // Depth increases strictly to the right, and every node has a connector except the root.
    expect(byId.get('root')!.x).toBeLessThan(a.x);
    expect(a.x).toBeLessThan(a1.x);
    expect(layout.connectors.size).toBe(layout.nodes.length - 1);
    expect([...layout.connectors.values()].every((d) => d.startsWith('M ') && d.includes(' C '))).toBe(true);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('radial: the root sits at the center and distance grows with depth', () => {
    const layout = layoutMindMap(tree, 'radial');
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const root = byId.get('root')!;
    expect(root.x).toBeCloseTo(layout.width / 2, 5);
    expect(root.y).toBeCloseTo(layout.height / 2, 5);
    const distance = (id: string) => Math.hypot(byId.get(id)!.x - root.x, byId.get(id)!.y - root.y);
    expect(distance('a')).toBeGreaterThan(0);
    expect(distance('a1')).toBeGreaterThan(distance('a'));
    // Subtrees claim distinct wedges: sibling branch centers point in different directions.
    const angle = (id: string) => Math.atan2(byId.get(id)!.y - root.y, byId.get(id)!.x - root.x);
    expect(Math.abs(angle('a') - angle('b'))).toBeGreaterThan(0.2);
    expect(Math.abs(angle('b') - angle('c'))).toBeGreaterThan(0.2);
    expect(layout.connectors.size).toBe(layout.nodes.length - 1);
  });

  it('handles a root with no children in both layouts', () => {
    const lone: OutlineNode = { id: 'only', text: 'Solo', children: [] };
    for (const kind of ['hierarchical', 'radial'] as const) {
      const layout = layoutMindMap(lone, kind);
      expect(layout.nodes).toHaveLength(1);
      expect(layout.connectors.size).toBe(0);
      expect(Number.isFinite(layout.nodes[0].x)).toBe(true);
      expect(Number.isFinite(layout.nodes[0].y)).toBe(true);
    }
  });

  it('radial: wide trees never overlap boxes', () => {
    const wide: OutlineNode = {
      id: 'root',
      text: 'Main idea',
      children: Array.from({ length: 12 }, (_, index) => ({
        id: `c${index}`,
        text: `Branch number ${index} with a long label`,
        children: [],
      })),
    };
    const layout = layoutMindMap(wide, 'radial');
    const nodes = layout.nodes;
    for (let first = 0; first < nodes.length; first += 1) {
      for (let second = first + 1; second < nodes.length; second += 1) {
        const a = nodes[first];
        const b = nodes[second];
        const overlapX = Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 4;
        const overlapY = Math.abs(a.y - b.y) < (a.height + b.height) / 2 + 4;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it('radial: connectors start and end on box edges, not through box centers', () => {
    const layout = layoutMindMap(tree, 'radial');
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const strictlyInside = (x: number, y: number, box: { x: number; y: number; width: number; height: number }) =>
      Math.abs(x - box.x) < box.width / 2 - 0.5 && Math.abs(y - box.y) < box.height / 2 - 0.5;
    for (const node of layout.nodes) {
      if (!node.parentId) continue;
      const path = layout.connectors.get(node.id)!;
      const numbers = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      const [startX, startY, , , , , endX, endY] = numbers;
      expect(strictlyInside(startX, startY, byId.get(node.parentId)!)).toBe(false);
      expect(strictlyInside(endX, endY, node)).toBe(false);
    }
  });
});
