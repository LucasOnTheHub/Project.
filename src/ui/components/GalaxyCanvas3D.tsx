/**
 * GalaxyCanvas3D — M8
 *
 * Améliorations UX fluidité & LOD :
 *   - Transition caméra ease-in-out (smoothstep) au lieu du lerp brutal
 *   - LOD adaptatif : NodePoint remplacé par InstancedMesh (1 draw call pour tous les points)
 *   - Fade progressif des labels de nom d'étoiles selon la distance caméra
 *   - Animation de l'intensité pointLight lors du focus/unfocus
 *   - Blocage des interactions pendant le vol de caméra (isAnimating)
 *   - Star glow pulse animé en vue galaxie
 *
 * Navigation :
 *   - Vue galaxie (par défaut) : tous les systèmes visibles, nodes en LOD "points"
 *   - Clic sur une étoile → focus zoom sur ce système, détail complet
 *   - Bouton "↩ Galaxie" (breadcrumb) → revenir à la vue d'ensemble
 *
 * LOD :
 *   - En vue galaxie : seules les étoiles (master) + halos, nodes → InstancedMesh points lumineux
 *   - En vue système : affichage complet identique à GraphCanvas3D
 */

import React, {
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { GalaxyGraph, GalaxyStar } from '../../types/galaxy.js';
import type { ProjectNode, NodeType, TaskMetadata } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_COLORS_HEX: Record<NodeType, number> = {
  master:   0xf0c060,
  doc:      0x60a8ff,
  code:     0x7cfc8a,
  asset:    0xd4a8ff,
  task:     0xff8c6b,
  note:     0x70d8d8,
  reminder: 0xff6b9d,
};

const TYPE_COLORS: Record<NodeType, string> = {
  master:   '#f0c060',
  doc:      '#60a8ff',
  code:     '#7cfc8a',
  asset:    '#d4a8ff',
  task:     '#ff8c6b',
  note:     '#70d8d8',
  reminder: '#ff6b9d',
};

const ORBIT_SCALE     = 18;
const MIN_SIZE        = 0.25;
const MAX_SIZE        = 0.7;
const MASTER_SIZE     = 1.2;
const GRAVITY_STR     = 0.04;
const REPULSION       = 80;
const DAMPING         = 0.88;
const LINK_SPRING     = 0.012;
const LINK_REST_LEN   = 5;
const TAG_SPRING      = 0.003;
const TAG_REST_LEN    = 10;
const PARENT_SPRING   = 0.04;
const PARENT_REST_LEN = 3;

// LOD thresholds
const SYSTEM_ZOOM_THRESHOLD  = 50;   // camera distance → switch to galaxy view
const STAR_LABEL_NEAR_DIST   = 120;  // full opacity label
const STAR_LABEL_FAR_DIST    = 250;  // faded-out label

// Camera animation
const CAM_ANIM_SPEED    = 0.055; // lerp factor per frame (used in eased animation)
const CAM_ARRIVAL_DIST  = 1.5;   // distance threshold to consider "arrived"

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface SimNode {
  id: string;
  path: string;
  node: ProjectNode;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  size: number;
  color: number;
  isMaster: boolean;
  starIndex: number;
  offset: THREE.Vector3;
}

interface SimEdge {
  from: string;
  to: string;
  kind: 'link' | 'tag' | 'parent';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gravityToSize(gravity: number, isMaster: boolean, isChild = false) {
  if (isMaster) return MASTER_SIZE;
  const base = MIN_SIZE + gravity * (MAX_SIZE - MIN_SIZE);
  return isChild ? base * 0.6 : base;
}

function makeInitialPos(
  gravity: number,
  isMaster: boolean,
  idx: number,
  total: number,
  offset: THREE.Vector3,
): THREE.Vector3 {
  if (isMaster) return offset.clone();
  const r = (1 - gravity) * ORBIT_SCALE * 0.8 + 2;
  const phi   = Math.acos(1 - 2 * ((idx + 0.5) / total));
  const theta = Math.PI * (1 + Math.sqrt(5)) * idx;
  return new THREE.Vector3(
    offset.x + r * Math.sin(phi) * Math.cos(theta),
    offset.y + r * Math.cos(phi),
    offset.z + r * Math.sin(phi) * Math.sin(theta),
  );
}

function nodeId(vaultRoot: string, path: string) {
  return `${vaultRoot}::${path}`;
}

/** Smoothstep easing — maps t∈[0,1] to smooth [0,1] */
function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// ---------------------------------------------------------------------------
// Physics hook
// ---------------------------------------------------------------------------

function usePhysics(simNodes: SimNode[], simEdges: SimEdge[]) {
  const nodeMapRef = useRef<Map<string, SimNode>>(new Map());

  useEffect(() => {
    nodeMapRef.current = new Map(simNodes.map((n) => [n.id, n]));
  }, [simNodes]);

  useFrame(() => {
    if (simNodes.length === 0) return;
    const map = nodeMapRef.current;

    for (const n of simNodes) {
      if (n.isMaster) {
        n.vel.set(0, 0, 0);
        n.pos.copy(n.offset);
        continue;
      }
      const local = n.pos.clone().sub(n.offset);
      const dist = local.length() || 0.001;
      const targetR = (1 - n.node.metadata.gravity) * ORBIT_SCALE + 1;
      const radialForce = (dist - targetR) * -GRAVITY_STR;
      const dir = local.normalize().multiplyScalar(radialForce);
      n.vel.add(dir);
    }

    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const a = simNodes[i];
        const b = simNodes[j];
        if (a.starIndex !== b.starIndex) continue;
        const diff = a.pos.clone().sub(b.pos);
        const dist2 = diff.lengthSq() || 0.001;
        if (dist2 > 400) continue;
        const force = diff.normalize().multiplyScalar(REPULSION / dist2);
        if (!a.isMaster) a.vel.add(force);
        if (!b.isMaster) b.vel.sub(force);
      }
    }

    for (const edge of simEdges) {
      const a = map.get(edge.from);
      const b = map.get(edge.to);
      if (!a || !b) continue;
      const diff = a.pos.clone().sub(b.pos);
      const dist = diff.length() || 0.001;
      let restLen: number, k: number;
      if (edge.kind === 'parent')     { restLen = PARENT_REST_LEN; k = PARENT_SPRING; }
      else if (edge.kind === 'link')  { restLen = LINK_REST_LEN;   k = LINK_SPRING; }
      else                            { restLen = TAG_REST_LEN;     k = TAG_SPRING; }
      const force = diff.normalize().multiplyScalar(k * (dist - restLen));
      if (!a.isMaster) a.vel.sub(force);
      if (!b.isMaster) b.vel.add(force);
    }

    for (const n of simNodes) {
      if (n.isMaster) continue;
      n.vel.multiplyScalar(DAMPING);
      n.pos.add(n.vel);
    }
  });
}

// ---------------------------------------------------------------------------
// Star glow sphere (M8: pulse animation en galaxy view)
// ---------------------------------------------------------------------------

function StarGlow({
  pos,
  color,
  radius,
  pulse = false,
}: {
  pos: THREE.Vector3;
  color: number;
  radius: number;
  pulse?: boolean;
}) {
  const ref    = useRef<THREE.Mesh>(null!);
  const haloRef = useRef<THREE.Mesh>(null!);
  const timeRef = useRef(0);

  useFrame((_, dt) => {
    timeRef.current += dt;
    if (ref.current) {
      ref.current.position.copy(pos);
      ref.current.rotation.y += dt * 0.25;
      if (pulse) {
        // subtle scale pulse in galaxy view
        const s = 1 + Math.sin(timeRef.current * 1.2) * 0.04;
        ref.current.scale.setScalar(s);
      }
    }
    if (haloRef.current) {
      haloRef.current.position.copy(pos);
      if (pulse) {
        const mat = haloRef.current.material as THREE.MeshStandardMaterial;
        mat.opacity = 0.05 + Math.sin(timeRef.current * 0.8) * 0.025;
      }
    }
  });

  return (
    <group>
      <mesh ref={ref}>
        <sphereGeometry args={[radius, 32, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} metalness={0.3} roughness={0.4} />
      </mesh>
      <mesh ref={haloRef} position={pos}>
        <sphereGeometry args={[radius * 2.6, 16, 16]} />
        <meshStandardMaterial color={color} transparent opacity={0.07} side={THREE.BackSide} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// InstancedMesh for LOD node points (M8 performance)
// Replaces N individual NodePoint meshes with a single draw call
// ---------------------------------------------------------------------------

function NodePointsInstanced({
  nodes,
  starIndex,
}: {
  nodes: SimNode[];
  starIndex: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const filtered = useMemo(
    () => nodes.filter((n) => n.starIndex === starIndex && !n.isMaster),
    [nodes, starIndex],
  );

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    if (!meshRef.current || filtered.length === 0) return;
    filtered.forEach((n, i) => {
      dummy.position.copy(n.pos);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      // Each instance gets its color from node type
      meshRef.current.setColorAt(i, new THREE.Color(n.color));
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  if (filtered.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, filtered.length]}>
      <sphereGeometry args={[0.15, 6, 6]} />
      <meshStandardMaterial emissiveIntensity={0.6} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// Full node mesh (system view)
// ---------------------------------------------------------------------------

function NodeMesh({
  simNode,
  isSelected,
  onClick,
}: {
  simNode: SimNode;
  isSelected: boolean;
  onClick: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const t = simNode.node.metadata.type;
  const s = simNode.size;
  const color = simNode.color;

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.position.copy(simNode.pos);
      meshRef.current.rotation.y += delta * (simNode.isMaster ? 0.3 : 0.15);
    }
  });

  const emissiveIntensity = isSelected ? 2.0 : simNode.isMaster ? 1.2 : 0.4;
  const matProps = { color, emissive: color, emissiveIntensity, metalness: 0.3, roughness: 0.4 };

  let geo: React.ReactNode;
  switch (t) {
    case 'master':   geo = <sphereGeometry args={[s, 32, 32]} />; break;
    case 'doc':      geo = <sphereGeometry args={[s * 0.75, 16, 16]} />; break;
    case 'code':     geo = <boxGeometry args={[s * 1.2, s * 1.2, s * 1.2]} />; break;
    case 'task':     geo = <tetrahedronGeometry args={[s * 1.1, 0]} />; break;
    case 'note':     geo = <octahedronGeometry args={[s * 0.9, 0]} />; break;
    case 'asset':    geo = <cylinderGeometry args={[s * 0.6, s * 0.8, s * 1.4, 8]} />; break;
    case 'reminder': geo = <torusGeometry args={[s * 0.6, s * 0.2, 8, 16]} />; break;
    default:         geo = <sphereGeometry args={[s * 0.75, 16, 16]} />; break;
  }

  return (
    <group>
      {isSelected && (
        <mesh position={simNode.pos}>
          <torusGeometry args={[s * 1.6, 0.05, 8, 32]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} />
        </mesh>
      )}
      <mesh ref={meshRef} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        {geo}
        <meshStandardMaterial {...matProps} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Edge line
// ---------------------------------------------------------------------------

function EdgeLine({ from, to, kind }: { from: THREE.Vector3; to: THREE.Vector3; kind: string }) {
  const lineObj = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(6);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const color = kind === 'link' ? 0xffffff : kind === 'parent' ? 0xff8c6b : 0x555577;
    const opacity = kind === 'link' ? 0.35 : kind === 'parent' ? 0.45 : 0.15;
    return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  }, [kind]);

  useFrame(() => {
    const p = lineObj.geometry.attributes['position'] as THREE.BufferAttribute;
    p.setXYZ(0, from.x, from.y, from.z);
    p.setXYZ(1, to.x,   to.y,   to.z);
    p.needsUpdate = true;
  });

  return <primitive object={lineObj} />;
}

// ---------------------------------------------------------------------------
// Background stars
// ---------------------------------------------------------------------------

function Stars() {
  const ref = useRef<THREE.Points>(null!);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const count = 2000;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) pos[i] = (Math.random() - 0.5) * 600;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * 0.003; });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color={0xffffff} size={0.2} sizeAttenuation transparent opacity={0.4} />
    </points>
  );
}

// ---------------------------------------------------------------------------
// Camera animator — M8: eased transition with arrival detection
// ---------------------------------------------------------------------------

interface CamAnimState {
  targetPos: THREE.Vector3;
  targetLook: THREE.Vector3;
  distance: number;
  progress: number;   // 0 → 1 animation progress
  startCamPos: THREE.Vector3;
  startLook: THREE.Vector3;
  active: boolean;
}

function CameraAnimator({
  target,
  distance,
  onArrived,
}: {
  target: THREE.Vector3 | null;
  distance: number;
  onArrived: () => void;
}) {
  const { camera, controls } = useThree();
  const stateRef = useRef<CamAnimState | null>(null);
  const arrivedRef = useRef(false);

  useEffect(() => {
    if (!target) return;
    const oc = controls as unknown as { target: THREE.Vector3 } | null;
    const currentLook = oc ? oc.target.clone() : new THREE.Vector3();
    // Direction from current camera to target — keep same approach angle
    const dir = camera.position.clone().sub(currentLook).normalize();
    const desiredCamPos = target.clone().add(dir.multiplyScalar(distance));

    stateRef.current = {
      targetPos:  desiredCamPos,
      targetLook: target.clone(),
      distance,
      progress:   0,
      startCamPos: camera.position.clone(),
      startLook:   currentLook,
      active: true,
    };
    arrivedRef.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, distance]);

  useFrame((_, dt) => {
    const state = stateRef.current;
    if (!state || !state.active) return;
    const oc = controls as unknown as { target: THREE.Vector3 } | null;

    // Advance progress (speed scaled by dt, ~60fps baseline)
    state.progress = Math.min(1, state.progress + dt * 1.4);
    const t = smoothstep(state.progress);

    // Interpolate camera position and orbit target
    camera.position.lerpVectors(state.startCamPos, state.targetPos, t);
    if (oc) oc.target.lerpVectors(state.startLook, state.targetLook, t);

    // Detect arrival
    if (state.progress >= 1 && !arrivedRef.current) {
      arrivedRef.current = true;
      state.active = false;
      onArrived();
    }
  });

  return null;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

interface SceneProps {
  galaxy: GalaxyGraph;
  focusedStar: number | null;
  selected: string | null;
  onSelectNode: (id: string | null) => void;
  onFocusStar: (idx: number) => void;
  onCameraArrived: () => void;
}

function Scene({ galaxy, focusedStar, selected, onSelectNode, onFocusStar, onCameraArrived }: SceneProps) {
  const { simNodes, simEdges } = useMemo(() => {
    const nodes: SimNode[] = [];
    const edges: SimEdge[] = [];

    galaxy.stars.forEach((star, starIdx) => {
      const offset = new THREE.Vector3(star.offset.x, star.offset.y, star.offset.z);
      const childPaths = new Set<string>(
        star.graph.nodes
          .filter((n) => n.metadata.type === 'task' && (n.metadata as TaskMetadata).parent)
          .map((n) => n.path),
      );

      star.graph.nodes.forEach((node, i) => {
        const isMaster = node.metadata.type === 'master';
        const isChild = childPaths.has(node.path);
        nodes.push({
          id: nodeId(star.vaultRoot, node.path),
          path: node.path,
          node,
          pos: makeInitialPos(node.metadata.gravity, isMaster, i, star.graph.nodes.length, offset),
          vel: new THREE.Vector3(),
          size: gravityToSize(node.metadata.gravity, isMaster, isChild),
          color: TYPE_COLORS_HEX[node.metadata.type] ?? 0x888888,
          isMaster,
          starIndex: starIdx,
          offset,
        });
      });

      for (const edge of star.graph.edges) {
        edges.push({
          from: nodeId(star.vaultRoot, edge.from),
          to:   nodeId(star.vaultRoot, edge.to),
          kind: edge.kind as SimEdge['kind'],
        });
      }

      for (const node of star.graph.nodes) {
        if (node.metadata.type === 'task') {
          const parent = (node.metadata as TaskMetadata).parent;
          if (parent) {
            edges.push({
              from: nodeId(star.vaultRoot, parent),
              to:   nodeId(star.vaultRoot, node.path),
              kind: 'parent',
            });
          }
        }
      }
    });

    return { simNodes: nodes, simEdges: edges };
  }, [galaxy]);

  const nodeMap = useMemo(
    () => new Map(simNodes.map((n) => [n.id, n])),
    [simNodes],
  );

  usePhysics(simNodes, simEdges);

  // Camera animation target
  const { camera } = useThree();
  const [camTarget, setCamTarget] = useState<THREE.Vector3 | null>(null);
  const [camDistance, setCamDistance] = useState(80);

  useEffect(() => {
    if (focusedStar !== null) {
      const star = galaxy.stars[focusedStar];
      if (star) {
        setCamTarget(new THREE.Vector3(star.offset.x, star.offset.y, star.offset.z));
        setCamDistance(40);
      }
    } else {
      const center = new THREE.Vector3();
      if (galaxy.stars.length > 1) {
        for (const s of galaxy.stars) { center.x += s.offset.x; center.z += s.offset.z; }
        center.divideScalar(galaxy.stars.length);
      }
      setCamTarget(center);
      const maxRadius = galaxy.stars.reduce((m, s) => Math.max(m, Math.abs(s.offset.x), Math.abs(s.offset.z)), 60);
      setCamDistance(maxRadius * 2.2);
    }
  }, [focusedStar, galaxy.stars]);

  // LOD: camera distance determines view mode
  const camDist = camera.position.length();
  const isGalaxyView = focusedStar === null || camDist > SYSTEM_ZOOM_THRESHOLD;

  return (
    <>
      <CameraAnimator target={camTarget} distance={camDistance} onArrived={onCameraArrived} />
      <Stars />
      <ambientLight intensity={0.25} />

      {galaxy.stars.map((star, starIdx) => {
        const offset = new THREE.Vector3(star.offset.x, star.offset.y, star.offset.z);
        const masterSim = simNodes.find((n) => n.starIndex === starIdx && n.isMaster);
        const masterPos = masterSim ? masterSim.pos : offset;
        const isFocused = focusedStar === starIdx;

        // M8: LOD-based star label opacity based on camera distance
        const distToStar = camera.position.distanceTo(masterPos);
        const labelOpacity = isGalaxyView
          ? Math.max(0, Math.min(1, 1 - (distToStar - STAR_LABEL_NEAR_DIST) / (STAR_LABEL_FAR_DIST - STAR_LABEL_NEAR_DIST)))
          : isFocused ? 1 : 0.3;

        return (
          <group key={star.vaultRoot}>
            {/* Point light — stronger when focused */}
            <pointLight
              position={[masterPos.x, masterPos.y, masterPos.z]}
              intensity={isFocused ? 5 : isGalaxyView ? 2 : 1.5}
              distance={isFocused ? 100 : 80}
              color={star.starColor}
            />

            {/* Master star glow — M8: pulse in galaxy view */}
            <StarGlow
              pos={masterPos}
              color={star.starColor}
              radius={MASTER_SIZE * (isFocused ? 1.4 : 1.0)}
              pulse={isGalaxyView && !isFocused}
            />

            {/* Click target on star */}
            <mesh
              position={masterPos}
              onClick={(e) => {
                e.stopPropagation();
                onFocusStar(starIdx);
              }}
            >
              <sphereGeometry args={[MASTER_SIZE * 3, 8, 8]} />
              <meshStandardMaterial transparent opacity={0} />
            </mesh>

            {/* Star name label — M8: fade by camera distance */}
            <Html
              position={[masterPos.x, masterPos.y + MASTER_SIZE * 3.5, masterPos.z]}
              center
              distanceFactor={30}
              style={{ pointerEvents: 'none' }}
            >
              <div style={{
                color: `#${star.starColor.toString(16).padStart(6, '0')}`,
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                textShadow: '0 1px 6px rgba(0,0,0,0.9)',
                fontFamily: '"Inter", system-ui, sans-serif',
                opacity: labelOpacity,
                transition: 'opacity 0.3s ease',
              }}>
                {star.graph.name}
              </div>
            </Html>

            {/* Nodes — M8: InstancedMesh in galaxy view, full NodeMesh in system view */}
            {isGalaxyView ? (
              <NodePointsInstanced nodes={simNodes} starIndex={starIdx} />
            ) : (
              simNodes
                .filter((n) => n.starIndex === starIdx && !n.isMaster)
                .map((sn) => (
                  <NodeMesh
                    key={sn.id}
                    simNode={sn}
                    isSelected={sn.id === selected}
                    onClick={() => onSelectNode(sn.id === selected ? null : sn.id)}
                  />
                ))
            )}

            {/* Edges — only in system view for focused star */}
            {!isGalaxyView && isFocused && simEdges
              .filter((e) => nodeMap.get(e.from)?.starIndex === starIdx)
              .map((e, i) => {
                const a = nodeMap.get(e.from);
                const b = nodeMap.get(e.to);
                if (!a || !b) return null;
                return <EdgeLine key={i} from={a.pos} to={b.pos} kind={e.kind} />;
              })
            }
          </group>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function Tooltip({ node, onClose }: { node: ProjectNode | null; onClose: () => void }) {
  if (!node) return null;
  const m = node.metadata;
  const color = TYPE_COLORS[m.type] ?? '#888';
  return (
    <div style={{
      position: 'absolute', right: 16, top: 16, width: 260,
      background: 'rgba(10,10,18,0.92)',
      border: `1px solid ${color}50`,
      borderRadius: 10, padding: '14px 16px',
      backdropFilter: 'blur(14px)', color: '#e0e0f0',
      fontFamily: '"Inter", system-ui, sans-serif', fontSize: 12, zIndex: 100,
      boxShadow: `0 0 28px ${color}22`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
        <span style={{ fontWeight: 600, color, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.path}
        </span>
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>
      {([
        ['type',    m.type],
        ['status',  m.status],
        ['gravity', m.gravity],
        ['project', m.project],
        ['tags',    m.tags?.join(', ')],
      ] as [string, unknown][]).filter(([, v]) => v !== undefined && v !== '').map(([label, value]) => (
        <div key={label as string} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <span style={{ color: 'rgba(255,255,255,0.3)', minWidth: 60 }}>{label as string}</span>
          <span style={{ color: '#e0e0f0', wordBreak: 'break-all' }}>{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalaxyCanvas3D — public component
// ---------------------------------------------------------------------------

export interface GalaxyCanvas3DProps {
  galaxy: GalaxyGraph;
  onBack?: () => void;
}

export function GalaxyCanvas3D({ galaxy, onBack }: GalaxyCanvas3DProps) {
  const [focusedStar, setFocusedStar]   = useState<number | null>(null);
  const [selected, setSelected]         = useState<string | null>(null);
  // M8: block clicks on stars while camera is animating
  const [isAnimating, setIsAnimating]   = useState(false);

  const selectedNode = useMemo(() => {
    if (!selected) return null;
    for (const star of galaxy.stars) {
      const [, path] = selected.split('::');
      const found = star.graph.nodes.find((n) => n.path === path);
      if (found) return found;
    }
    return null;
  }, [selected, galaxy]);

  const handleFocusStar = useCallback((idx: number) => {
    if (isAnimating) return;
    setIsAnimating(true);
    setFocusedStar(idx);
    setSelected(null);
  }, [isAnimating]);

  const handleBackToGalaxy = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setFocusedStar(null);
    setSelected(null);
  }, [isAnimating]);

  const handleCameraArrived = useCallback(() => {
    setIsAnimating(false);
  }, []);

  const focusedStarData = focusedStar !== null ? galaxy.stars[focusedStar] : null;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [0, 60, 120], fov: 60, near: 0.1, far: 2000 }}
        style={{ background: '#050508' }}
        onPointerMissed={() => setSelected(null)}
      >
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.06}
          minDistance={2}
          maxDistance={800}
          // M8: disable orbit during camera flight to avoid fighting the animator
          enabled={!isAnimating}
        />
        <Scene
          galaxy={galaxy}
          focusedStar={focusedStar}
          selected={selected}
          onSelectNode={setSelected}
          onFocusStar={handleFocusStar}
          onCameraArrived={handleCameraArrived}
        />
      </Canvas>

      {/* Breadcrumb / nav bar */}
      <div style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'rgba(10,10,18,0.85)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10, padding: '6px 14px',
        fontSize: 12, color: 'rgba(255,255,255,0.5)',
        backdropFilter: 'blur(10px)',
        userSelect: 'none',
        opacity: isAnimating ? 0.5 : 1,
        transition: 'opacity 0.2s ease',
      }}>
        {onBack && (
          <button
            onClick={onBack}
            disabled={isAnimating}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: isAnimating ? 'default' : 'pointer', fontSize: 12, padding: 0, marginRight: 4 }}
          >
            ← Solo
          </button>
        )}

        <span
          onClick={handleBackToGalaxy}
          style={{ cursor: isAnimating ? 'default' : 'pointer', color: focusedStar === null ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)' }}
        >
          🌌 Galaxie
        </span>

        {focusedStarData && (
          <>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>›</span>
            <span style={{ color: `#${focusedStarData.starColor.toString(16).padStart(6, '0')}`, fontWeight: 600 }}>
              {focusedStarData.graph.name}
            </span>
          </>
        )}

        <span style={{ color: 'rgba(255,255,255,0.2)', marginLeft: 8 }}>
          {galaxy.stars.length} projets · {galaxy.totalNodes} nœuds
        </span>
      </div>

      {/* Camera flight hint */}
      {isAnimating && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          fontSize: 11, color: 'rgba(255,255,255,0.3)',
          pointerEvents: 'none',
          animation: 'none',
        }}>
          En vol…
        </div>
      )}

      {/* Click star hint (galaxy overview, not animating) */}
      {focusedStar === null && !isAnimating && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          fontSize: 11, color: 'rgba(255,255,255,0.2)',
          pointerEvents: 'none',
        }}>
          Cliquer sur une étoile pour zoomer sur le projet
        </div>
      )}

      <Tooltip node={selectedNode} onClose={() => setSelected(null)} />
    </div>
  );
}
