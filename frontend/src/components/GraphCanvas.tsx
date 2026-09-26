"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { Focus, Minus, Plus } from "lucide-react";
import { nodeId, type GraphData, type GraphNode, type GraphLink } from "@/lib/types";

import { graphColor } from "@/lib/graph-style";

const labelFor = (name: string) => name.length > 30 ? name.slice(0, 28) + "\u2026" : name;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const LINK_CURVATURE = -0.25;
type LabelBox = { x: number; y: number; width: number; height: number };
const overlaps = (a: LabelBox, b: LabelBox) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export default function GraphCanvas({ data, width, height, selectedId, reset, onSelect }: {
  data: GraphData; width: number; height: number; selectedId?: string; reset: number;
  onSelect: (node: GraphNode) => void;
}) {
  const ref = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const needsFit = useRef(true);
  const labelBoxes = useRef(new Map<string, LabelBox>());
  const zoomFrame = useRef<number | undefined>(undefined);
  const [hoveredId, setHoveredId] = useState<string>();
  const [zoom, setZoom] = useState(1);
  // Keep simulation-owned nodes across resizes: inspecting evidence must not restart it.
  const layout = useMemo(() => ({
    nodes: data.nodes.map((node, i) => ({ ...node,
      x: Math.cos(i * 2.39996) * 110 * Math.sqrt(i),
      y: Math.sin(i * 2.39996) * 110 * Math.sqrt(i),
    })),
    links: data.links.map(link => ({ ...link, source: nodeId(link.source), target: nodeId(link.target) })),
  }), [data]);
  const candidateId = hoveredId ?? selectedId;
  const focusId = data.nodes.some(node => node.id === candidateId) ? candidateId : undefined;
  const connected = useMemo(() => {
    const ids = new Set<string>();
    if (focusId) {
      ids.add(focusId);
      data.links.forEach(link => {
        if (nodeId(link.source) === focusId) ids.add(nodeId(link.target));
        if (nodeId(link.target) === focusId) ids.add(nodeId(link.source));
      });
    }
    return ids;
  }, [data, focusId]);
  const isRelated = (link: GraphLink) => !focusId || nodeId(link.source) === focusId || nodeId(link.target) === focusId;

  const fit = useCallback(() => {
    const graph = ref.current;
    if (!graph || !layout.nodes.length || !width || !height) return;
    const xs = layout.nodes.map(node => node.x ?? 0);
    const ys = layout.nodes.map(node => node.y ?? 0);
    const left = Math.min(...xs), right = Math.max(...xs);
    const top = Math.min(...ys), bottom = Math.max(...ys);
    // Reserve screen pixels for labels, rings, and controls. Never magnify tiny results.
    const labelPadding = Math.min(240, Math.max(...layout.nodes.map(node => labelFor(node.name).length)) * 7 + 40);
    const scale = Math.max(MIN_ZOOM, Math.min(1.15,
      (width - labelPadding) / Math.max(right - left, 1),
      (height - 125) / Math.max(bottom - top, 1)));
    graph.centerAt((left + right) / 2, (top + bottom) / 2 + 8 / scale, 0);
    graph.zoom(scale, 0);
  }, [layout, width, height]);

  useEffect(() => {
    const graph = ref.current;
    if (!graph) return;
    graph.d3Force("charge")?.strength(-1100);
    graph.d3Force("link")?.distance(180).strength(0.35);
    needsFit.current = true;
    graph.d3ReheatSimulation();
  }, [layout]);
  useEffect(() => { fit(); }, [fit, reset]);

  useEffect(() => () => {
    if (zoomFrame.current !== undefined) cancelAnimationFrame(zoomFrame.current);
  }, []);

  function changeZoom(multiplier: number) {
    const graph = ref.current;
    if (graph) graph.zoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, graph.zoom() * multiplier)), 0);
  }

  return <>
    <ForceGraph2D<GraphNode, GraphLink>
      ref={ref} width={width} height={height} graphData={layout}
      backgroundColor="#101917" nodeLabel={() => ""} linkLabel={() => ""}
      nodeColor={node => graphColor(node.type)}
      linkColor={link => isRelated(link) ? "#819c8e" : "#33463d"}
      linkWidth={link => isRelated(link) && focusId ? 2 : 1.2}
      linkCurvature={LINK_CURVATURE}
      linkDirectionalArrowLength={7 / zoom} linkDirectionalArrowRelPos={0.88}
      enableNodeDrag={width >= 600} enablePanInteraction={width >= 600}
      enableZoomInteraction={event => width >= 600 || event.ctrlKey || event.metaKey}
      onRenderFramePre={() => labelBoxes.current.clear()}
      cooldownTicks={90} d3VelocityDecay={0.4} minZoom={MIN_ZOOM} maxZoom={MAX_ZOOM}
      onNodeClick={node => onSelect(node)} onNodeHover={node => setHoveredId(node?.id)}
      onNodeDrag={() => { needsFit.current = false; }}
      onZoom={({ k }) => {
        // The library can emit zoom synchronously while React applies a resize.
        // Defer the indicator update until after that render, coalescing wheel events.
        if (zoomFrame.current !== undefined) cancelAnimationFrame(zoomFrame.current);
        zoomFrame.current = requestAnimationFrame(() => setZoom(k));
      }}
      onEngineStop={() => { if (needsFit.current) { needsFit.current = false; fit(); } }}
      nodeCanvasObject={(node, ctx, scale) => {
        const x = node.x ?? 0, y = node.y ?? 0;
        const active = node.id === selectedId || node.id === hoveredId;
        const relevant = !focusId || connected.has(node.id);
        // All glyph and label sizes are screen pixels, independent of zoom.
        ctx.save(); ctx.globalAlpha = relevant ? 1 : 0.6;
        if (active) {
          ctx.beginPath(); ctx.arc(x, y, 14 / scale, 0, Math.PI * 2);
          ctx.fillStyle = "#b5ecc622"; ctx.fill();
          ctx.strokeStyle = "#c6f3d7"; ctx.lineWidth = 1.5 / scale; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(x, y, (active ? 8 : 6) / scale, 0, Math.PI * 2);
        ctx.fillStyle = graphColor(node.type); ctx.fill();
        ctx.font = (active ? "600 " : "500 ") + 13 / scale + "px sans-serif";
        ctx.textAlign = "left"; ctx.textBaseline = "top";
        const label = labelFor(node.name);
        const boxWidth = ctx.measureText(label).width + 8 / scale;
        const boxHeight = 21 / scale;
        // Pick a nearby free label position instead of painting labels on top of
        // each other at overview zoom. Check node hit areas as well as other labels.
        const candidates = [
          [x - boxWidth / 2, y + 14 / scale],
          [x - boxWidth / 2, y - 36 / scale],
          [x + 16 / scale, y - boxHeight / 2],
          [x - boxWidth - 16 / scale, y - boxHeight / 2],
          [x - boxWidth / 2, y + 37 / scale],
          [x - boxWidth / 2, y - 59 / scale],
        ].map(([left, top]) => ({ x: left, y: top, width: boxWidth, height: boxHeight }));
        const box = candidates.find(candidate => {
          const screen = ref.current?.graph2ScreenCoords(candidate.x, candidate.y);
          if (!screen || screen.x < 8 || screen.x + boxWidth * scale > width - 8 || screen.y < 8 || screen.y + boxHeight * scale > height - 54) return false;
          if (Array.from(labelBoxes.current.values()).some(other => overlaps(candidate, other))) return false;
          return !layout.nodes.some(other => overlaps(candidate, {
            x: other.x - 11 / scale, y: other.y - 11 / scale, width: 22 / scale, height: 22 / scale,
          }));
        });
        if (box) {
          labelBoxes.current.set(node.id, box);
          if (box !== candidates[0]) {
            ctx.beginPath(); ctx.moveTo(x, y);
            ctx.lineTo(box.x + box.width / 2, box.y + box.height / 2);
            ctx.strokeStyle = "#52695b"; ctx.lineWidth = 0.7 / scale; ctx.stroke();
          }
          ctx.fillStyle = "#101917"; ctx.fillRect(box.x, box.y, box.width, box.height);
          ctx.fillStyle = "#edf5f1"; ctx.fillText(label, box.x + 4 / scale, box.y + 4 / scale);
        }
        ctx.restore();
      }}
      nodePointerAreaPaint={(node, color, ctx, scale) => {
        const x = node.x ?? 0, y = node.y ?? 0;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, 15 / scale, 0, Math.PI * 2); ctx.fill();
        const box = labelBoxes.current.get(node.id);
        if (box) ctx.fillRect(box.x, box.y, box.width, box.height);
      }}
      linkCanvasObjectMode={() => "after"}
      linkCanvasObject={(link, ctx, scale) => {
        if (!isRelated(link) || (scale < 0.55 && !focusId)) return;
        const source = link.source as GraphNode, target = link.target as GraphNode;
        if (source.x === undefined || target.x === undefined) return;
        const dx = target.x - source.x, dy = (target.y ?? 0) - (source.y ?? 0);
        const text = labelFor(link.type.replaceAll("_", " ").toLowerCase());
        ctx.save(); ctx.font = 10 / scale + "px sans-serif";
        const textWidth = ctx.measureText(text).width;
        if (Math.hypot(dx, dy) < textWidth + 48 / scale) { ctx.restore(); return; }
        // Midpoint of the same quadratic curve used by the graph library.
        ctx.translate(source.x + dx * 0.5 + dy * LINK_CURVATURE * 0.5,
          (source.y ?? 0) + dy * 0.5 - dx * LINK_CURVATURE * 0.5);
        let angle = Math.atan2(dy, dx);
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
        ctx.rotate(angle); ctx.fillStyle = "#101917";
        ctx.fillRect(-textWidth / 2 - 4 / scale, -8 / scale, textWidth + 8 / scale, 16 / scale);
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = focusId ? "#d8f1e1" : "#b0c5b8"; ctx.fillText(text, 0, 0);
        ctx.restore();
      }}
    />
    <div className="graph-view-controls" aria-label="Graph view controls">
      <button onClick={() => changeZoom(1 / 1.25)} disabled={zoom <= MIN_ZOOM + 0.001} aria-label="Zoom out" title="Zoom out"><Minus size={16} /></button>
      <output aria-label="Graph zoom">{Math.round(zoom * 100)}%</output>
      <button onClick={() => changeZoom(1.25)} disabled={zoom >= MAX_ZOOM - 0.001} aria-label="Zoom in" title="Zoom in"><Plus size={16} /></button>
      <button onClick={fit} aria-label="Fit graph to view" title="Fit graph to view"><Focus size={17} /></button>
    </div>
  </>;
}
