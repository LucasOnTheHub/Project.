/**
 * GraphCanvas — d3 force-directed graph renderer (M2)
 *
 * Visual encoding:
 *   - Node color  → NodeType  (7 distinct colors)
 *   - Node radius → gravity   (bigger = higher gravity = closer to master)
 *   - Tag edges   → dashed grey links (shared-tag clustering affinity)
 *   - Link edges  → solid colored links (explicit front-matter links)
 *   - Selected node → tooltip panel with metadata
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { ProjectGraph, ProjectNode, ProjectEdge, NodeType } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<NodeType, string> = {
  master: '#f0c060',   // gold — the star
  doc:    '#60a8ff',   // blue
  code:   '#7cfc8a',   // green
  asset:  '#d4a8ff',   // purple
  task:   '#ff8c6b',   // orange
  note:   '#70d8d8',   // teal
  reminder: '#ff6b9d', // pink
};

const MIN_RADIUS = 5;
const MAX_RADIUS = 22;
const MASTER_RADIUS = 28;

// ---------------------------------------------------------------------------
// D3 simulation node/link types
// ---------------------------------------------------------------------------

interface SimNode extends d3.SimulationNodeDatum {
  id: string;       // path
  node: ProjectNode;
  radius: number;
  color: string;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  edge: ProjectEdge;
  kind: 'link' | 'tag';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gravityToRadius(gravity: number, isMaster: boolean): number {
  if (isMaster) return MASTER_RADIUS;
  return MIN_RADIUS + gravity * (MAX_RADIUS - MIN_RADIUS);
}

function nodeColor(type: NodeType): string {
  return TYPE_COLORS[type] ?? '#888';
}

// ---------------------------------------------------------------------------
// Tooltip panel
// ---------------------------------------------------------------------------

interface TooltipProps {
  node: ProjectNode | null;
  onClose: () => void;
}

function Tooltip({ node, onClose }: TooltipProps) {
  if (!node) return null;
  const m = node.metadata;
  const color = nodeColor(m.type);

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    right: 16,
    top: 16,
    width: 260,
    background: 'rgba(13,13,20,0.92)',
    border: `1px solid ${color}40`,
    borderRadius: 10,
    padding: '14px 16px',
    backdropFilter: 'blur(12px)',
    color: '#e0e0f0',
    fontFamily: 'inherit',
    fontSize: 12,
    zIndex: 100,
    boxShadow: `0 0 20px ${color}20`,
  };

  const row = (label: string, value: string | number | boolean | undefined) =>
    value !== undefined ? (
      <div key={label} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <span style={{ color: 'rgba(255,255,255,0.35)', minWidth: 64 }}>{label}</span>
        <span style={{ color: '#e0e0f0', wordBreak: 'break-all' }}>{String(value)}</span>
      </div>
    ) : null;

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%',
          background: color, display: 'inline-block', flexShrink: 0,
        }} />
        <span style={{ fontWeight: 600, color, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.path}
        </span>
        <button
          onClick={onClose}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
        >×</button>
      </div>
      {row('type', m.type)}
      {row('status', m.status)}
      {row('gravity', m.gravity)}
      {row('project', m.project)}
      {m.tags?.length ? row('tags', m.tags.join(', ')) : null}
      {m.links?.length ? row('links', m.links.join(', ')) : null}
      {row('created', m.created)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function Legend() {
  return (
    <div style={{
      position: 'absolute', left: 16, bottom: 16,
      background: 'rgba(13,13,20,0.85)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 8, padding: '10px 14px', backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11,
    }}>
      {(Object.entries(TYPE_COLORS) as [NodeType, string][]).map(([type, color]) => (
        <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, display: 'inline-block' }} />
          <span style={{ color: 'rgba(255,255,255,0.55)' }}>{type}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 4, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width={22} height={8}><line x1={0} y1={4} x2={22} y2={4} stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} /></svg>
          <span style={{ color: 'rgba(255,255,255,0.4)' }}>explicit link</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width={22} height={8}><line x1={0} y1={4} x2={22} y2={4} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="3,2" /></svg>
          <span style={{ color: 'rgba(255,255,255,0.4)' }}>tag affinity</span>
        </div>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>size = gravity</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GraphCanvas
// ---------------------------------------------------------------------------

interface GraphCanvasProps {
  graph: ProjectGraph;
}

export function GraphCanvas({ graph }: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<ProjectNode | null>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  const handleClose = useCallback(() => setSelected(null), []);

  useEffect(() => {
    const svg = d3.select(svgRef.current!);
    svg.selectAll('*').remove();

    const rect = svgRef.current!.getBoundingClientRect();
    const W = rect.width || 1200;
    const H = rect.height || 700;

    // ── Build sim nodes ──────────────────────────────────────────────────────
    const simNodes: SimNode[] = graph.nodes.map((n) => ({
      id: n.path,
      node: n,
      radius: gravityToRadius(n.metadata.gravity, n.metadata.type === 'master'),
      color: nodeColor(n.metadata.type),
      x: W / 2 + (Math.random() - 0.5) * 200,
      y: H / 2 + (Math.random() - 0.5) * 200,
    }));

    const nodeById = new Map(simNodes.map((n) => [n.id, n]));

    // ── Build sim links ──────────────────────────────────────────────────────
    const simLinks: SimLink[] = graph.edges
      .map((e) => {
        const source = nodeById.get(e.from);
        const target = nodeById.get(e.to);
        if (!source || !target) return null;
        return { source, target, edge: e, kind: e.kind } as SimLink;
      })
      .filter((l): l is SimLink => l !== null);

    // ── SVG setup ────────────────────────────────────────────────────────────
    svg.attr('width', W).attr('height', H);

    // Gradient defs for the master star glow
    const defs = svg.append('defs');
    const radialGrad = defs.append('radialGradient').attr('id', 'star-glow');
    radialGrad.append('stop').attr('offset', '0%').attr('stop-color', '#f0c060').attr('stop-opacity', 0.5);
    radialGrad.append('stop').attr('offset', '100%').attr('stop-color', '#f0c060').attr('stop-opacity', 0);

    // Arrow marker
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 10)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'rgba(255,255,255,0.25)');

    // Root group (for zoom/pan)
    const rootG = svg.append('g').attr('class', 'root');

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on('zoom', (event) => rootG.attr('transform', event.transform));
    svg.call(zoom);
    svg.call(zoom.translateTo, W / 2, H / 2);

    // ── Links ────────────────────────────────────────────────────────────────
    const linkG = rootG.append('g').attr('class', 'links');

    const linkEl = linkG
      .selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', (d) => d.kind === 'link' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)')
      .attr('stroke-width', (d) => d.kind === 'link' ? 1.5 : 0.8)
      .attr('stroke-dasharray', (d) => d.kind === 'tag' ? '4,3' : null)
      .attr('marker-end', (d) => d.kind === 'link' ? 'url(#arrow)' : null);

    // ── Nodes ────────────────────────────────────────────────────────────────
    const nodeG = rootG.append('g').attr('class', 'nodes');

    const nodeEl = nodeG
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(simNodes, (d) => d.id)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .on('click', (_event, d) => setSelected(d.node));

    // Star glow for master
    nodeEl.filter((d) => d.node.metadata.type === 'master')
      .append('circle')
      .attr('r', (d) => d.radius * 2.5)
      .attr('fill', 'url(#star-glow)');

    // Main circle
    nodeEl.append('circle')
      .attr('r', (d) => d.radius)
      .attr('fill', (d) => d.color)
      .attr('fill-opacity', (d) => d.node.metadata.type === 'master' ? 1 : 0.85)
      .attr('stroke', (d) => d.color)
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6);

    // Label
    nodeEl.append('text')
      .text((d) => {
        const parts = d.id.split('/');
        return parts[parts.length - 1] ?? d.id;
      })
      .attr('dy', (d) => d.radius + 12)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(255,255,255,0.65)')
      .attr('font-size', 10)
      .attr('font-family', 'inherit')
      .attr('pointer-events', 'none');

    // ── Drag ─────────────────────────────────────────────────────────────────
    const drag = d3.drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeEl.call(drag);

    // ── Simulation ───────────────────────────────────────────────────────────
    const sim = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((d) => d.kind === 'link' ? 100 : 160)
        .strength((d) => d.kind === 'link' ? 0.4 : 0.05),
      )
      .force('charge', d3.forceManyBody<SimNode>().strength((d) => -120 - d.radius * 6))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.05))
      // Gravity pull toward center proportional to node gravity value
      .force('radial', d3.forceRadial<SimNode>(
        (d) => d.node.metadata.type === 'master' ? 0 : (1 - d.node.metadata.gravity) * 300 + 40,
        W / 2,
        H / 2,
      ).strength((d) => d.node.metadata.gravity * 0.4))
      .force('collision', d3.forceCollide<SimNode>().radius((d) => d.radius + 4))
      .on('tick', () => {
        linkEl
          .attr('x1', (d) => (d.source as SimNode).x!)
          .attr('y1', (d) => (d.source as SimNode).y!)
          .attr('x2', (d) => {
            const s = d.source as SimNode;
            const t = d.target as SimNode;
            const dx = t.x! - s.x!;
            const dy = t.y! - s.y!;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            return t.x! - (dx / dist) * (t.radius + 2);
          })
          .attr('y2', (d) => {
            const s = d.source as SimNode;
            const t = d.target as SimNode;
            const dx = t.x! - s.x!;
            const dy = t.y! - s.y!;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            return t.y! - (dy / dist) * (t.radius + 2);
          });

        nodeEl.attr('transform', (d) => `translate(${d.x!},${d.y!})`);
      });

    simRef.current = sim;

    return () => {
      sim.stop();
    };
  }, [graph]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      <Tooltip node={selected} onClose={handleClose} />
      <Legend />
    </div>
  );
}
