import { Component, input, computed, ElementRef, AfterViewChecked, viewChild } from '@angular/core';
import { TreeNode } from '../../services/wison';

interface LayoutNode {
  label:      string;
  isTerminal: boolean;
  x:          number;
  y:          number;
  children:   LayoutNode[];
  parent?:    LayoutNode;
}

const NODE_W   = 90;   // ancho reservado por nodo
const NODE_H   = 36;   // alto del rectángulo del nodo
const LEVEL_H  = 70;   // separación vertical entre niveles
const PAD_X    = 20;   // padding lateral del SVG
const PAD_Y    = 20;   // padding superior

@Component({
  selector: 'app-tree-viewer',
  templateUrl: './tree-viewer.html',
  styleUrl:    './tree-viewer.css'
})
export class TreeViewer {
  tree = input<TreeNode | null>(null);

  layout = computed(() => {
    const root = this.tree();
    if (!root) return null;
    return this.buildLayout(root);
  });

  svgWidth = computed(() => {
    const l = this.layout();
    if (!l) return 400;
    return Math.max(400, this.treeWidth(l.root) * NODE_W + PAD_X * 2);
  });

  svgHeight = computed(() => {
    const l = this.layout();
    if (!l) return 200;
    return (l.depth + 1) * LEVEL_H + PAD_Y * 2 + NODE_H;
  });

  edges = computed(() => {
    const l = this.layout();
    if (!l) return [];
    const result: { x1:number; y1:number; x2:number; y2:number }[] = [];
    this.collectEdges(l.root, result);
    return result;
  });

  nodes = computed(() => {
    const l = this.layout();
    if (!l) return [];
    const result: LayoutNode[] = [];
    this.collectNodes(l.root, result);
    return result;
  });

  // ── Layout algorithm (Reingold-Tilford simplificado) ─────────────────────

  private buildLayout(root: TreeNode): { root: LayoutNode; depth: number } {
    const lRoot = this.toLayout(root);
    const depth = this.maxDepth(lRoot);
    this.assignX(lRoot, { counter: 0 });
    this.assignY(lRoot, 0);
    return { root: lRoot, depth };
  }

  private toLayout(node: TreeNode, parent?: LayoutNode): LayoutNode {
    const l: LayoutNode = {
      label:      node.isTerminal
                  ? (node.label === 'ε' ? 'ε' : `"${node.lexeme}"`)
                  : node.label,
      isTerminal: node.isTerminal,
      x: 0, y: 0,
      children: [],
      parent
    };
    l.children = node.children.map(c => this.toLayout(c, l));
    return l;
  }

  private treeWidth(node: LayoutNode): number {
    if (node.children.length === 0) return 1;
    return node.children.reduce((s, c) => s + this.treeWidth(c), 0);
  }

  private maxDepth(node: LayoutNode): number {
    if (node.children.length === 0) return 0;
    return 1 + Math.max(...node.children.map(c => this.maxDepth(c)));
  }

  // Asigna coordenada X basada en posición de hoja (contador global)
  private assignX(node: LayoutNode, counter: { counter: number }): void {
    if (node.children.length === 0) {
      node.x = PAD_X + counter.counter * NODE_W + NODE_W / 2;
      counter.counter++;
      return;
    }
    for (const c of node.children) this.assignX(c, counter);
    // Centrar el padre sobre sus hijos
    const first = node.children[0].x;
    const last  = node.children[node.children.length - 1].x;
    node.x = (first + last) / 2;
  }

  private assignY(node: LayoutNode, level: number): void {
    node.y = PAD_Y + level * LEVEL_H;
    for (const c of node.children) this.assignY(c, level + 1);
  }

  private collectEdges(node: LayoutNode, out: { x1:number; y1:number; x2:number; y2:number }[]): void {
    for (const c of node.children) {
      out.push({
        x1: node.x,
        y1: node.y + NODE_H,
        x2: c.x,
        y2: c.y
      });
      this.collectEdges(c, out);
    }
  }

  private collectNodes(node: LayoutNode, out: LayoutNode[]): void {
    out.push(node);
    for (const c of node.children) this.collectNodes(c, out);
  }

  nodeX(n: LayoutNode): number { return n.x - NODE_W / 2; }
  nodeY(n: LayoutNode): number { return n.y; }
  nodeW(): number { return NODE_W; }
  nodeH(): number { return NODE_H; }
}