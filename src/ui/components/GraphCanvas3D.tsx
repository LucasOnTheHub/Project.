/**
 * GraphCanvas3D — three.js / react-three-fiber renderer (M3)
 *
 * Visual encoding (§5 guideline):
 *   - Étoile centrale  → sphère émissive dorée, glow halo
 *   - Nodes par type   → cube=code, sphère=doc, tétraèdre=task, octaèdre=note,
 *                        cylindre=asset, tore=reminder, sphère XL=master
 *   - Taille           → gravity (plus la gravité est haute, plus le node est gros)
 *   - Couleur          → NodeType (identique à M2)
 *   - Liens explicites → tubes lumineux blancs
 *   - Tag affinity     → lignes pointillées grises
 *   - Gravité          → attraction radiale vers l'étoile (force-directed 3D custom)
 *   - LOD labels       → HTML overlay via @react-three/drei <Html>, disparaissent en zoom out
 *   - Caméra           → OrbitControls libre + focus au clic
 */

import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useLayoutEffect,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html, Sphere, Box, Octahedron, Torus, Cone } from '@react-three/drei';
import * as THREE from 'three';
import type { ProjectGraph, ProjectNode, ProjectEdge, NodeType, TaskMetadata } from '../../types/index.js';
import { TaskPanel } from './TaskPanel.js';
import { GitPanel } from './GitPanel.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<NodeType, string> = {
  master:   '#f0c060',
  doc:      '#60a8ff',
  code:     '#7cfc8a',
  asset:    '#d4a8ff',
  task:     '#ff8c6b',
  note:     '#70d8d8',
  reminder: '#ff6b9d',
};

const TYPE_COLORS_HEX: Record<NodeType, number> = {
  master:   0xf0c060,
  doc:      0x60a8ff,
  code:     0x7cfc8a,
  asset:    0xd4a8ff,
  task:     0xff8c6b,
  note:     0x70d8d8,
  reminder: 0xff6b9d,
};

// Orbit radius for each node based on (1 - gravity) — master fixed at center
const ORBIT_SCALE = 18; // max orbit radius in units
const MIN_SIZE    = 0.25;
const MAX_SIZE    = 0.7;
const MASTER_SIZE = 1.2;

// Physics constants
const GRAVITY_STRENGTH   = 0.04;
const REPULSION          = 80;
const DAMPING            = 0.88;
const LINK_SPRING        = 0.012;
const LINK_REST_LEN      = 5;
const TAG_SPRING         = 0.003;
const TAG_REST_LEN       = 10;
const PARENT_SPRING      = 0.04;  // strong spring for subtask → parent
const PARENT_REST_LEN    = 3;     // keep subtasks close to parent
const SIM_STEPS          = 1; // physics steps per frame

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SimNode {
  id: string;
  node: ProjectNode;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  size: number;
  color: number;
  isMaster: boolean;
}

interface SimEdge {
  from: string;
  to: string;
  kind: 'link' | 'tag' | 'parent';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gravityToSize(gravity: number, isMaster: boolean, isChild: boolean = false): number {
  if (isMaster) return MASTER_SIZE;
  const base = MIN_SIZE + gravity * (MAX_SIZE - MIN_SIZE);
  return isChild ? base * 0.6 : base;
}

function makeInitialPos(gravity: number, isMaster: boolean, idx: number, total: number): THREE.Vector3 {
  if (isMaster) return new THREE.Vector3(0, 0, 0);
  const r = (1 - gravity) * ORBIT_SCALE * 0.8 + 2;
  const phi   = Math.acos(1 - 2 * ((idx + 0.5) / total));
  const theta = Math.PI * (1 + Math.sqrt(5)) * idx;
  return new THREE.Vector3(
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

// ---------------------------------------------------------------------------
// Node mesh — shape depends on type
// ---------------------------------------------------------------------------

interface NodeMeshProps {
  simNode: SimNode;
  isSelected: boolean;
  onClick: () => void;
}

function NodeMesh({ simNode, isSelected, onClick }: NodeMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const glowRef = useRef<THREE.Mesh>(null!);
  const t = simNode.node.metadata.type;
  const s = simNode.size;
  const color = simNode.color;

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.position.copy(simNode.pos);
      if (simNode.isMaster) {
        meshRef.current.rotation.y += delta * 0.3;
        meshRef.current.rotation.x += delta * 0.1;
      } else {
        meshRef.current.rotation.y += delta * 0.15;
      }
    }
    if (glowRef.current) {
      glowRef.current.position.copy(simNode.pos);
    }
  });

  const emissiveIntensity = isSelected ? 2.0 : simNode.isMaster ? 1.2 : 0.4;

  const matProps = {
    color,
    emissive: color,
    emissiveIntensity,
    metalness: 0.3,
    roughness: 0.4,
  };

  let geometry: React.ReactNode;
  switch (t) {
    case 'master':
      geometry = <sphereGeometry args={[s, 32, 32]} />;
      break;
    case 'doc':
      geometry = <sphereGeometry args={[s * 0.75, 16, 16]} />;
      break;
    case 'code':
      geometry = <boxGeometry args={[s * 1.2, s * 1.2, s * 1.2]} />;
      break;
    case 'task':
      // tetrahedron
      geometry = <tetrahedronGeometry args={[s * 1.1, 0]} />;
      break;
    case 'note':
      geometry = <octahedronGeometry args={[s * 0.9, 0]} />;
      break;
    case 'asset':
      geometry = <cylinderGeometry args={[s * 0.6, s * 0.8, s * 1.4, 8]} />;
      break;
    case 'reminder':
      geometry = <torusGeometry args={[s * 0.6, s * 0.2, 8, 16]} />;
      break;
    default:
      geometry = <sphereGeometry args={[s * 0.75, 16, 16]} />;
  }

  return (
    <group>
      {/* Glow halo for master */}
      {simNode.isMaster && (
        <mesh ref={glowRef}>
          <sphereGeometry args={[s * 2.5, 16, 16]} />
          <meshStandardMaterial
            color={color}
            transparent
            opacity={0.08}
            side={THREE.BackSide}
          />
        </mesh>
      )}

      {/* Selection ring */}
      {isSelected && (
        <mesh position={simNode.pos}>
          <torusGeometry args={[s * 1.6, 0.05, 8, 32]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} />
        </mesh>
      )}

      {/* Main mesh */}
      <mesh
        ref={meshRef}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        castShadow
      >
        {geometry}
        <meshStandardMaterial {...matProps} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Edge line (link or tag)
// ---------------------------------------------------------------------------

interface EdgeLineProps {
  from: THREE.Vector3;
  to:   THREE.Vector3;
  kind: 'link' | 'tag' | 'parent';
}

function EdgeLine({ from, to, kind }: EdgeLineProps) {
  const lineRef = useRef<THREE.Line>(null!);

  // Build the THREE.Line object once
  const lineObj = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(6);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const color = kind === 'link' ? 0xffffff : kind === 'parent' ? 0xff8c6b : 0x555577;
    const opacity = kind === 'link' ? 0.35 : kind === 'parent' ? 0.45 : 0.15;
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    return new THREE.Line(geo, mat);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useFrame(() => {
    const pos = lineObj.geometry.attributes['position'] as THREE.BufferAttribute;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x,   to.y,   to.z);
    pos.needsUpdate = true;
  });

  return <primitive ref={lineRef} object={lineObj} />;
}

// ---------------------------------------------------------------------------
// Node label (HTML overlay via drei)
// ---------------------------------------------------------------------------

interface NodeLabelProps {
  simNode: SimNode;
  /** 0–1 opacity driven by camera distance (M8 LOD) */
  opacity: number;
}

function NodeLabel({ simNode, opacity }: NodeLabelProps) {
  if (opacity <= 0) return null;
  const name = simNode.id.split('/').pop() ?? simNode.id;
  const colorStr = TYPE_COLORS[simNode.node.metadata.type] ?? '#fff';

  return (
    <Html
      position={simNode.pos}
      center
      distanceFactor={20}
      style={{ pointerEvents: 'none' }}
    >
      <div style={{
        color: colorStr,
        fontSize: 10,
        whiteSpace: 'nowrap',
        textShadow: '0 1px 4px rgba(0,0,0,0.9)',
        transform: `translateY(${simNode.size * 26}px)`,
        fontFamily: '"Inter", system-ui, sans-serif',
        opacity: opacity * 0.8,
        transition: 'opacity 0.25s ease',
      }}>
        {name}
      </div>
    </Html>
  );
}

// ---------------------------------------------------------------------------
// Tooltip overlay (React DOM, fixed position)
// ---------------------------------------------------------------------------

interface TooltipProps {
  node: ProjectNode | null;
  onClose: () => void;
}

function Tooltip({ node, onClose }: TooltipProps) {
  if (!node) return null;
  const m = node.metadata;
  const color = TYPE_COLORS[m.type] ?? '#888';

  return (
    <div style={{
      position: 'absolute',
      right: 16,
      top: 16,
      width: 260,
      background: 'rgba(10,10,18,0.92)',
      border: `1px solid ${color}50`,
      borderRadius: 10,
      padding: '14px 16px',
      backdropFilter: 'blur(14px)',
      color: '#e0e0f0',
      fontFamily: '"Inter", system-ui, sans-serif',
      fontSize: 12,
      zIndex: 100,
      boxShadow: `0 0 28px ${color}22`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
        <span style={{ fontWeight: 600, color, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.path}
        </span>
        <button
          onClick={onClose}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
        >×</button>
      </div>
      {([
        ['type',    m.type],
        ['status',  m.status],
        ['gravity', m.gravity],
        ['project', m.project],
        ['tags',    m.tags?.join(', ')],
        ['links',   m.links?.join(', ')],
        ['created', m.created],
      ] as [string, string | number | undefined][]).filter(([, v]) => v !== undefined && v !== '').map(([label, value]) => (
        <div key={label} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <span style={{ color: 'rgba(255,255,255,0.3)', minWidth: 60 }}>{label}</span>
          <span style={{ color: '#e0e0f0', wordBreak: 'break-all' }}>{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function Legend() {
  const shapes: Record<NodeType, string> = {
    master: '●',
    doc:    '●',
    code:   '■',
    task:   '▲',
    note:   '◆',
    asset:  '⬡',
    reminder: '○',
  };
  return (
    <div style={{
      position: 'absolute', left: 16, bottom: 16,
      background: 'rgba(10,10,18,0.85)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 8, padding: '10px 14px', backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11,
      color: 'rgba(255,255,255,0.5)',
    }}>
      {(Object.entries(TYPE_COLORS) as [NodeType, string][]).map(([type, color]) => (
        <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ color, fontSize: 13 }}>{shapes[type]}</span>
          <span>{type}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 4, paddingTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
        size = gravity · drag to explore
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Physics simulation hook
// ---------------------------------------------------------------------------

function usePhysics(simNodes: SimNode[], simEdges: SimEdge[]) {
  const nodeMapRef = useRef<Map<string, SimNode>>(new Map());

  useEffect(() => {
    nodeMapRef.current = new Map(simNodes.map((n) => [n.id, n]));
  }, [simNodes]);

  useFrame(() => {
    const nodes = simNodes;
    if (nodes.length === 0) return;

    const map = nodeMapRef.current;

    for (let step = 0; step < SIM_STEPS; step++) {
      // Gravity toward origin (master is pinned at 0,0,0)
      for (const n of nodes) {
        if (n.isMaster) { n.vel.set(0, 0, 0); n.pos.set(0, 0, 0); continue; }
        const dist = n.pos.length() || 0.001;
        const targetR = (1 - n.node.metadata.gravity) * ORBIT_SCALE + 1;
        // Radial spring toward target orbit radius
        const radialForce = (dist - targetR) * -GRAVITY_STRENGTH;
        const dir = n.pos.clone().normalize().multiplyScalar(radialForce);
        n.vel.add(dir);
      }

      // Repulsion between all nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const diff = a.pos.clone().sub(b.pos);
          const dist2 = diff.lengthSq() || 0.001;
          if (dist2 > 400) continue; // skip far pairs
          const force = diff.normalize().multiplyScalar(REPULSION / dist2);
          if (!a.isMaster) a.vel.add(force);
          if (!b.isMaster) b.vel.sub(force);
        }
      }

      // Spring forces along edges
      for (const edge of simEdges) {
        const a = map.get(edge.from);
        const b = map.get(edge.to);
        if (!a || !b) continue;
        const diff = a.pos.clone().sub(b.pos);
        const dist = diff.length() || 0.001;
        let restLen: number;
        let k: number;
        if (edge.kind === 'parent') {
          restLen = PARENT_REST_LEN;
          k = PARENT_SPRING;
        } else if (edge.kind === 'link') {
          restLen = LINK_REST_LEN;
          k = LINK_SPRING;
        } else {
          restLen = TAG_REST_LEN;
          k = TAG_SPRING;
        }
        const force = diff.normalize().multiplyScalar(k * (dist - restLen));
        if (!a.isMaster) a.vel.sub(force);
        if (!b.isMaster) b.vel.add(force);
      }

      // Integrate
      for (const n of nodes) {
        if (n.isMaster) continue;
        n.vel.multiplyScalar(DAMPING);
        n.pos.add(n.vel);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Camera focus
// ---------------------------------------------------------------------------

function CameraFocus({ target }: { target: THREE.Vector3 | null }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    if (!target || !controls) return;
    // Animate camera to look at the selected node
    const oc = controls as unknown as { target: THREE.Vector3 };
    oc.target.lerp(target, 0.15);
  }, [target, controls]);
  return null;
}

// ---------------------------------------------------------------------------
// Scene — manages physics + rendering
// ---------------------------------------------------------------------------

interface SceneProps {
  graph: ProjectGraph;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

function Scene({ graph, selected, onSelect }: SceneProps) {
  // Build sim data
  const { simNodes, simEdges } = useMemo(() => {
    // Collect all task nodes that have a parent (children)
    const childPaths = new Set<string>(
      graph.nodes
        .filter((nd) => nd.metadata.type === 'task' && (nd.metadata as TaskMetadata).parent)
        .map((nd) => nd.path),
    );

    const n = graph.nodes.map((node, i) => {
      const isMaster = node.metadata.type === 'master';
      const isChild = childPaths.has(node.path);
      return {
        id: node.path,
        node,
        pos: makeInitialPos(node.metadata.gravity, isMaster, i, graph.nodes.length),
        vel: new THREE.Vector3(),
        size: gravityToSize(node.metadata.gravity, isMaster, isChild),
        color: TYPE_COLORS_HEX[node.metadata.type] ?? 0x888888,
        isMaster,
      } satisfies SimNode;
    });

    // Standard graph edges
    const e: SimEdge[] = graph.edges
      .map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind as SimEdge['kind'] }));

    // Add parent→child edges for subtasks (physics spring)
    for (const node of graph.nodes) {
      if (node.metadata.type === 'task') {
        const parent = (node.metadata as TaskMetadata).parent;
        if (parent) {
          e.push({ from: parent, to: node.path, kind: 'parent' });
        }
      }
    }

    return { simNodes: n, simEdges: e };
  }, [graph]);

  const nodeMap = useMemo(
    () => new Map(simNodes.map((n) => [n.id, n])),
    [simNodes],
  );

  // Run physics every frame
  usePhysics(simNodes, simEdges);

  // Camera target for selected node
  const [camTarget, setCamTarget] = useState<THREE.Vector3 | null>(null);
  useEffect(() => {
    if (selected) {
      const sn = nodeMap.get(selected);
      if (sn) setCamTarget(sn.pos.clone());
    }
  }, [selected, nodeMap]);

  // M8 LOD: compute label opacity from camera distance — no setState in useFrame
  const { camera } = useThree();
  const labelOpacityRef = useRef(1);
  useFrame(() => {
    const d = camera.position.length();
    // Full labels within ORBIT_SCALE*2, fades out between 2× and 3×
    const near = ORBIT_SCALE * 2;
    const far  = ORBIT_SCALE * 3.5;
    labelOpacityRef.current = Math.max(0, Math.min(1, 1 - (d - near) / (far - near)));
  });

  return (
    <>
      <CameraFocus target={camTarget} />

      {/* Background stars */}
      <Stars />

      {/* Ambient + point lights */}
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 0, 0]} intensity={3} distance={60} color={0xf0c060} />
      <pointLight position={[20, 20, 20]} intensity={0.5} color={0x8899ff} />

      {/* Edges */}
      {simEdges.map((e, i) => {
        const a = nodeMap.get(e.from);
        const b = nodeMap.get(e.to);
        if (!a || !b) return null;
        return <EdgeLine key={i} from={a.pos} to={b.pos} kind={e.kind} />;
      })}

      {/* Nodes */}
      {simNodes.map((sn) => (
        <group key={sn.id}>
          <NodeMesh
            simNode={sn}
            isSelected={sn.id === selected}
            onClick={() => onSelect(sn.id === selected ? null : sn.id)}
          />
          <NodeLabel simNode={sn} opacity={labelOpacityRef.current} />
        </group>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Background star field
// ---------------------------------------------------------------------------

function Stars() {
  const ref = useRef<THREE.Points>(null!);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const count = 1200;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) pos[i] = (Math.random() - 0.5) * 300;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.005;
  });

  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color={0xffffff} size={0.15} sizeAttenuation transparent opacity={0.5} />
    </points>
  );
}

// ---------------------------------------------------------------------------
// GraphCanvas3D — public component
// ---------------------------------------------------------------------------

interface GraphCanvas3DProps {
  graph: ProjectGraph;
  onGraphRefresh?: () => void;
}

export function GraphCanvas3D({ graph, onGraphRefresh }: GraphCanvas3DProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => graph.nodes.find((n) => n.path === selected) ?? null,
    [selected, graph],
  );

  const handleClose = useCallback(() => setSelected(null), []);

  const taskCount = graph.nodes.filter((n) => n.metadata.type === 'task').length;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [0, 8, 28], fov: 60, near: 0.1, far: 1000 }}
        style={{ background: '#0a0a12' }}
        onPointerMissed={() => setSelected(null)}
      >
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.06}
          minDistance={2}
          maxDistance={120}
        />
        <Scene graph={graph} selected={selected} onSelect={setSelected} />
      </Canvas>

      {/* Task panel — left side */}
      {taskCount > 0 && (
        <TaskPanel
          graph={graph}
          selected={selected}
          onSelect={setSelected}
          onGraphRefresh={onGraphRefresh}
        />
      )}

      <Tooltip node={selectedNode} onClose={handleClose} />
      <Legend />

      {/* Git panel — right side (M5) */}
      <GitPanel onRefresh={onGraphRefresh} />

      {/* Node count badge */}
      <div style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        fontSize: 11, color: 'rgba(255,255,255,0.25)',
        background: 'rgba(255,255,255,0.04)',
        padding: '3px 10px', borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.07)',
        pointerEvents: 'none',
      }}>
        {graph.nodes.length} nodes · {graph.edges.length} edges · drag to orbit · scroll to zoom
      </div>
    </div>
  );
}
