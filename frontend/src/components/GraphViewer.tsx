"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { graphColor } from "@/lib/graph-style";
import { Search, RotateCcw, Network, ArrowUpRight } from "lucide-react";
import { nodeId, type GraphData, type GraphNode } from "@/lib/types";

const GraphCanvas = dynamic(() => import("./GraphCanvas"), {
  ssr: false, loading: () => <div className="graph-placeholder" role="status">Loading graph…</div>,
});

export default function GraphViewer({ graphData, selectedId, onNodeClick }: {
  graphData: GraphData; selectedId?: string; onNodeClick: (node: GraphNode) => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All types");
  const [neighbors, setNeighbors] = useState(true);
  const [reset, setReset] = useState(0);
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!area.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({
      width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height),
    }));
    observer.observe(area.current);
    return () => observer.disconnect();
  }, []);
  const types = useMemo(() => Array.from(new Set(graphData.nodes.map(node => node.type))).sort(), [graphData]);
  const matches = useMemo(() => graphData.nodes.filter(node =>
    (type === "All types" || node.type === type) && node.name.toLowerCase().includes(query.trim().toLowerCase())),
    [graphData, type, query]);
  const visible = useMemo(() => {
    const ids = new Set(matches.map(node => node.id));
    if (neighbors && (query.trim() || type !== "All types")) {
      graphData.links.forEach(link => {
        if (matches.some(node => node.id === nodeId(link.source) || node.id === nodeId(link.target))) {
          ids.add(nodeId(link.source)); ids.add(nodeId(link.target));
        }
      });
    }
    return {
      nodes: graphData.nodes.filter(node => ids.has(node.id)).map(node => ({ ...node })),
      links: graphData.links.filter(link => ids.has(nodeId(link.source)) && ids.has(nodeId(link.target)))
        .map(link => ({ ...link, source: nodeId(link.source), target: nodeId(link.target) })),
    };
  }, [matches, graphData, neighbors, query, type]);
  return <div className="graph-workspace">
    <div className="graph-toolbar">
      <label className="search-field"><Search size={16} /><span className="sr-only">Search entities</span>
        <input placeholder="Find an entity…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label><span className="sr-only">Entity type</span><select value={type} onChange={event => setType(event.target.value)}>
        <option>All types</option>{types.map(item => <option key={item}>{item}</option>)}
      </select></label>
      <button className="icon-button" title="Reset graph" aria-label="Reset graph" onClick={() => { setQuery(""); setType("All types"); setNeighbors(true); setReset(value => value + 1); }}><RotateCcw size={17} /></button>
    </div>
    <div className="graph-subbar">
      <span role="status">{matches.length} matching {matches.length === 1 ? "entity" : "entities"}{visible.nodes.length > matches.length ? ` + ${visible.nodes.length - matches.length} connected` : ""}<span className="graph-edge-count"> / {visible.links.length} connections</span></span>
      <label><input type="checkbox" checked={neighbors} onChange={event => setNeighbors(event.target.checked)} /> Include connections</label>
    </div>
    <div ref={area} className="graph-canvas" role="region" aria-label="Interactive knowledge graph">
      {matches.length === 0 ? <div className="graph-placeholder" role="status"><Search size={28} /><strong>No matching entities</strong><span>Try another name or clear the type filter.</span></div>
        : size.width > 0 && size.height > 0 && <GraphCanvas reset={reset} data={visible} width={size.width} height={size.height} selectedId={selectedId} onSelect={onNodeClick} />}

    </div>
    <div className="graph-legend" aria-label="Entity type legend">{types.map(item => <span key={item}><i className="entity-dot" style={{ background: graphColor(item) }} />{item}</span>)}<span className="canvas-hint">{size.width < 600 ? "Use controls to zoom. Select an entity to inspect." : "Drag to explore. Scroll to zoom."}</span></div>
    <div className="entity-list"><div className="section-label"><Network size={14} /> SELECT AN ENTITY</div>
      <div className="entity-buttons">{matches.map(node => <button key={node.id} className={"entity-chip" + (selectedId === node.id ? " selected" : "")} aria-pressed={selectedId === node.id} onClick={() => onNodeClick(node)}>
        <span className="entity-dot" style={{ background: graphColor(node.type) }} />{node.name}<ArrowUpRight size={13} />
      </button>)}</div>
    </div>
  </div>;
}
