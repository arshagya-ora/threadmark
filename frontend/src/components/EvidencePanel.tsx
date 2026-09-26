"use client";
import { useEffect, useRef } from "react";
import { X, FileText, ArrowUpRight, ArrowRight, BookOpen } from "lucide-react";
import { API_URL } from "@/lib/config";
import { nodeId, type GraphData, type GraphNode, type Source } from "@/lib/types";

export type EvidenceSelection = { kind: "source"; source: Source } | { kind: "node"; node: GraphNode };

export default function EvidencePanel({ selection, graph, onClose, onNode, onSource }: {
  selection: EvidenceSelection; graph: GraphData | null; onClose: () => void;
  onNode: (node: GraphNode) => void; onSource: (source: Source) => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const node = selection.kind === "node" ? selection.node : null;
  const source = selection.kind === "source" ? selection.source : null;
  const connections = graph?.links.filter(link => node && (nodeId(link.source) === node.id || nodeId(link.target) === node.id)) ?? [];
  return <aside className="evidence-panel" aria-label={node ? "Entity details" : "Source evidence"} onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
    <header className="panel-heading"><span><BookOpen size={17} />{node ? "Entity details" : "Source evidence"}</span>
      <button ref={close} className="icon-button" onClick={onClose} aria-label="Close evidence panel"><X size={18} /></button></header>
    <div className="evidence-content">
      {source && <>
        <span className="eyebrow">SOURCE {source.id}</span>
        <h2>{source.filename}</h2>
        <p className="muted">{source.section ?? (source.page ? "Page " + source.page : "Retrieved passage")}</p>
        <div className="source-excerpt">{source.text}</div>
        <p className="small muted">Read the passage to check whether it supports the answer.</p>
        <a className="secondary-button" target="_blank" rel="noopener noreferrer" href={source.document_id === "sample" ? "/samples/retrieval-field-guide.md" : API_URL + "/documents/" + source.document_id + "/file#page=" + (source.page ?? 1)}>
          <FileText size={16} />Open original document<ArrowUpRight size={15} /></a>
      </>}
      {node && <>
        <span className="eyebrow">{node.type}</span><h2>{node.name}</h2>
        <h3>{connections.length} {connections.length === 1 ? "connection" : "connections"}</h3>
        <div className="connection-list">{connections.map((link, index) => {
          const outgoing = nodeId(link.source) === node.id;
          const other = graph?.nodes.find(item => item.id === nodeId(outgoing ? link.target : link.source));
          return <button key={index} onClick={() => other && onNode(other)} disabled={!other}>
            <span className="relationship">{outgoing ? "Outgoing" : "Incoming"} · {link.type.replaceAll("_", " ").toLowerCase()}</span>
            <span>{other?.name ?? "Unknown entity"}<ArrowRight size={15} /></span>
          </button>;
        })}</div>
        <h3>Source mentions</h3>
        <p className="small muted">Passages mentioning this entity. A mention does not verify every relationship.</p>
        {node.sources?.length ? node.sources.map((item, index) => <button key={index} className="mention" onClick={() => onSource(item)}>
          <span><FileText size={14} />{item.section ?? ("Page " + (item.page ?? "?"))}<ArrowUpRight size={14} /></span>
          <p>{item.text.slice(0, 180)}{item.text.length > 180 ? "…" : ""}</p>
        </button>) : <p className="muted">No matching source passage was found for this entity.</p>}
      </>}
    </div>
  </aside>;
}
