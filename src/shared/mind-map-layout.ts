import type { OutlineNode } from './assets';

/**
 * Pure geometry for the mind map's decorative SVG views. The semantic
 * tree editor remains the authoritative, keyboard-operable surface;
 * these layouts only decide where boxes and connectors are drawn.
 */

export type MindMapLayoutKind = 'hierarchical' | 'radial';

export interface PlacedNode {
  id: string;
  text: string;
  depth: number;
  parentId?: string;
  /** Center coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MindMapLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  /** Cubic-bezier connector path per non-root node, keyed by node id. */
  connectors: Map<string, string>;
}

const FONT_SIZE = 13;
const CHAR_WIDTH = 7.2;
const NODE_HEIGHT = 30;
const MAX_NODE_WIDTH = 264;
const MIN_NODE_WIDTH = 56;
const H_GAP = 56;
const V_GAP = 14;
const PADDING = 24;

export function mindMapNodeWidth(text: string): number {
  const measured = Math.ceil(text.length * CHAR_WIDTH) + 24;
  return Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, measured));
}

interface LayoutTree {
  node: OutlineNode;
  width: number;
  children: LayoutTree[];
  subtreeHeight: number;
}

function toLayoutTree(node: OutlineNode): LayoutTree {
  const children = node.children.map(toLayoutTree);
  const childrenHeight = children.reduce((sum, child) => sum + child.subtreeHeight, 0) + Math.max(0, children.length - 1) * V_GAP;
  return { node, width: mindMapNodeWidth(node.text), children, subtreeHeight: Math.max(NODE_HEIGHT, childrenHeight) };
}

function depthWidths(tree: LayoutTree, depth: number, widths: number[]): void {
  widths[depth] = Math.max(widths[depth] ?? 0, tree.width);
  tree.children.forEach((child) => depthWidths(child, depth + 1, widths));
}

function hierarchical(root: OutlineNode): MindMapLayout {
  const tree = toLayoutTree(root);
  const widths: number[] = [];
  depthWidths(tree, 0, widths);
  const levelX: number[] = [];
  let cursor = PADDING;
  widths.forEach((width) => {
    levelX.push(cursor);
    cursor += width + H_GAP;
  });
  const nodes: PlacedNode[] = [];
  const connectors = new Map<string, string>();
  const place = (current: LayoutTree, depth: number, top: number, parent?: PlacedNode): void => {
    const centerY = top + current.subtreeHeight / 2;
    const placed: PlacedNode = {
      id: current.node.id,
      text: current.node.text,
      depth,
      parentId: parent?.id,
      x: levelX[depth] + widths[depth] / 2,
      y: centerY,
      width: current.width,
      height: NODE_HEIGHT,
    };
    nodes.push(placed);
    if (parent) {
      const startX = parent.x + parent.width / 2;
      const endX = placed.x - placed.width / 2;
      const middleX = (startX + endX) / 2;
      connectors.set(
        placed.id,
        `M ${startX} ${parent.y} C ${middleX} ${parent.y}, ${middleX} ${placed.y}, ${endX} ${placed.y}`,
      );
    }
    let childTop = top;
    current.children.forEach((child) => {
      place(child, depth + 1, childTop, placed);
      childTop += child.subtreeHeight + V_GAP;
    });
  };
  place(tree, 0, PADDING);
  return { width: cursor - H_GAP + PADDING, height: tree.subtreeHeight + PADDING * 2, nodes, connectors };
}

function countLeaves(tree: LayoutTree): number {
  return tree.children.length ? tree.children.reduce((sum, child) => sum + countLeaves(child), 0) : 1;
}

function radial(root: OutlineNode): MindMapLayout {
  const tree = toLayoutTree(root);
  const RING_GAP = 150;
  let maxDepth = 0;
  const measure = (current: LayoutTree, depth: number) => {
    maxDepth = Math.max(maxDepth, depth);
    current.children.forEach((child) => measure(child, depth + 1));
  };
  measure(tree, 0);
  const radius = PADDING + MAX_NODE_WIDTH / 2 + (maxDepth + 1) * RING_GAP;
  const center = radius;
  const nodes: PlacedNode[] = [];
  const connectors = new Map<string, string>();
  const place = (current: LayoutTree, depth: number, startAngle: number, endAngle: number, parent?: PlacedNode): void => {
    const angle = (startAngle + endAngle) / 2;
    const ring = depth === 0 ? 0 : depth * RING_GAP + MAX_NODE_WIDTH / 2;
    const placed: PlacedNode = {
      id: current.node.id,
      text: current.node.text,
      depth,
      parentId: parent?.id,
      x: depth === 0 ? center : center + ring * Math.cos(angle),
      y: depth === 0 ? center : center + ring * Math.sin(angle),
      width: current.width,
      height: NODE_HEIGHT,
    };
    nodes.push(placed);
    if (parent) {
      const control1 = {
        x: parent.x + (placed.x - parent.x) / 3,
        y: parent.y + (placed.y - parent.y) / 3,
      };
      const control2 = {
        x: parent.x + ((placed.x - parent.x) * 2) / 3,
        y: parent.y + ((placed.y - parent.y) * 2) / 3,
      };
      connectors.set(
        placed.id,
        `M ${parent.x} ${parent.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${placed.x} ${placed.y}`,
      );
    }
    const totalLeaves = countLeaves(current);
    let childStart = startAngle;
    current.children.forEach((child) => {
      const share = (countLeaves(child) / totalLeaves) * (endAngle - startAngle);
      place(child, depth + 1, childStart, childStart + share, placed);
      childStart += share;
    });
  };
  place(tree, 0, -Math.PI / 2, Math.PI * 1.5);
  return { width: radius * 2, height: radius * 2, nodes, connectors };
}

export function layoutMindMap(root: OutlineNode, kind: MindMapLayoutKind): MindMapLayout {
  return kind === 'radial' ? radial(root) : hierarchical(root);
}

export { FONT_SIZE as MIND_MAP_FONT_SIZE };
