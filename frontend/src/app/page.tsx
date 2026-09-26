"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpen, Check, ChevronRight, CircleAlert, FileText, FlaskConical, Layers3, LoaderCircle, MessageSquare, Network, Plus, RefreshCw, Send, ThumbsDown, ThumbsUp, Upload, Activity } from "lucide-react";
import GraphViewer from "@/components/GraphViewer";
import EvidencePanel, { type EvidenceSelection } from "@/components/EvidencePanel";
import AnswerMarkdown from "@/components/AnswerMarkdown";
import { APP_AUTHOR, APP_NAME, APP_TAGLINE } from "@/lib/config";
import { api } from "@/lib/api";
import { SAMPLE_DOCUMENT, SAMPLE_GRAPH, SAMPLE_QUESTIONS } from "@/lib/sample";
import type { GraphData, Message, ResearchDocument, Source } from "@/lib/types";

type Answer = { answer: string; sources: Source[]; request_id: string };
type GraphState = { data?: GraphData; loading?: boolean; error?: string };
const messageId = () => crypto.randomUUID();

export default function Home() {
  const [documents, setDocuments] = useState<ResearchDocument[]>([SAMPLE_DOCUMENT]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "graph">("chat");
  const [libraryError, setLibraryError] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [sessions, setSessions] = useState<Record<string, Message[]>>({});
  const [graphs, setGraphs] = useState<Record<string, GraphState>>({});
  const [graphRevision, setGraphRevision] = useState(0);
  const [selection, setSelection] = useState<EvidenceSelection | null>(null);
  const [question, setQuestion] = useState("");
  const [askingId, setAskingId] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState<string | null>(null);
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const active = documents.find(document => document.id === activeId);
  const messages = activeId ? sessions[activeId] ?? [] : [];
  const graphState = active?.sample ? { data: SAMPLE_GRAPH } : activeId ? graphs[activeId] ?? {} : {};
  const graph = graphState.data ?? null;
  const working = processing !== null;

  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const result = await api<{ documents: ResearchDocument[] }>("/documents");
      setDocuments([SAMPLE_DOCUMENT, ...result.documents]);
      setLibraryError("");
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "Unable to load documents.");
    } finally { setLibraryLoading(false); }
  }, []);
  useEffect(() => { void refreshLibrary(); }, [refreshLibrary]);

  useEffect(() => {
    if (!activeId || activeId === "sample" || active?.status !== "ready") return;
    const controller = new AbortController();
    const id = activeId;
    async function load() {
      setGraphs(previous => ({ ...previous, [id]: { loading: true } }));
      try {
        const data = await api<GraphData>("/documents/" + id + "/graph", { signal: controller.signal });
        if (!controller.signal.aborted) setGraphs(previous => ({ ...previous, [id]: { data } }));
      } catch (error) {
        if (!controller.signal.aborted) setGraphs(previous => ({ ...previous, [id]: { error: error instanceof Error ? error.message : "Unable to load graph." } }));
      }
    }
    void load();
    return () => controller.abort();
  }, [activeId, active?.status, graphRevision]);

  useEffect(() => { messagesEnd.current?.scrollIntoView({ block: "end", behavior: "instant" }); }, [messages.length, askingId]);

  function chooseDocument(document: ResearchDocument) {
    setActiveId(document.id); setSelection(null); setQuestion(""); setFeedbackError("");
  }
  function updateDocument(document: ResearchDocument) {
    setDocuments(previous => [SAMPLE_DOCUMENT, document, ...previous.filter(item => item.id !== "sample" && item.id !== document.id)]);
    setActiveId(document.id); setSelection(null);
  }
  async function upload(file: File) {
    if (busy.current) return;
    setUploadError(""); setPendingFile(file);
    if (!file.name.toLowerCase().endsWith(".pdf")) { setUploadError("Choose a PDF file."); return; }
    if (file.size > 20 * 1024 * 1024) { setUploadError("This PDF exceeds the 20 MB limit."); return; }
    busy.current = true; setProcessing(file.name);
    try {
      const body = new FormData(); body.append("file", file);
      const document = await api<ResearchDocument>("/upload", { method: "POST", body }, 180000);
      updateDocument(document); setPendingFile(null); setTab("chat"); setGraphRevision(value => value + 1);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed. Retry this document.");
      void refreshLibrary();
    } finally { setProcessing(null); busy.current = false; }
  }
  async function retryDocument(document: ResearchDocument) {
    if (busy.current) return;
    busy.current = true; setProcessing(document.filename); setUploadError("");
    try {
      const updated = await api<ResearchDocument>("/documents/" + document.id + "/retry", { method: "POST" }, 180000);
      updateDocument(updated); setGraphRevision(value => value + 1);
    } catch (error) { setUploadError(error instanceof Error ? error.message : "Retry failed."); }
    finally { busy.current = false; setProcessing(null); }
  }
  async function ask(text: string, retryId?: string) {
    if (!active || !text.trim() || askingId || active.status !== "ready") return;
    const document = active;
    const id = document.id;
    setQuestion(""); setAskingId(id); setFeedbackError("");
    setSessions(previous => ({
      ...previous, [id]: [
        ...(previous[id] ?? []).filter(message => message.id !== retryId),
        ...(!retryId ? [{ id: messageId(), role: "user" as const, content: text }] : []),
      ],
    }));
    try {
      if (document.sample) {
        const prepared = SAMPLE_QUESTIONS.find(item => item.question === text);
        if (!prepared) throw new Error("The sample contains three prepared answers. Choose a suggested question, or upload a PDF to ask your own.");
        setSessions(previous => ({ ...previous, [id]: [...(previous[id] ?? []), {
          id: messageId(), role: "assistant", content: prepared.answer, sources: prepared.sources,
        }] }));
      } else {
        const result = await api<Answer>("/ask", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: text.trim(), document_id: id }) }, 120000);
        setSessions(previous => ({ ...previous, [id]: [...(previous[id] ?? []), {
          id: messageId(), role: "assistant", content: result.answer, sources: result.sources, request_id: result.request_id,
        }] }));
      }
    } catch (error) {
      setSessions(previous => ({ ...previous, [id]: [...(previous[id] ?? []), {
        id: messageId(), role: "assistant", content: error instanceof Error ? error.message : "Answer failed.",
        error: true, retryQuestion: text,
      }] }));
    } finally { setAskingId(null); }
  }
  async function feedback(message: Message, value: number) {
    if (!message.request_id || !activeId || feedbackBusy) return;
    const id = activeId;
    setFeedbackBusy(message.id); setFeedbackError("");
    try {
      await api("/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: message.request_id, feedback: value }) });
      setSessions(previous => ({ ...previous, [id]: previous[id].map(item => item.id === message.id ? { ...item, feedback: value } : item) }));
    } catch (error) { setFeedbackError(error instanceof Error ? error.message : "Feedback was not saved. Please retry."); }
    finally { setFeedbackBusy(null); }
  }
  const onSource = (source: Source) => setSelection({ kind: "source", source });

  return <div className="research-app">
    <a href="#research-main" className="skip-link">Skip to research workspace</a>
    <aside className="library-sidebar" aria-label="Document library">
      <Link href="/" className="brand"><span className="brand-mark">T<span /></span><span>{APP_NAME}<small>{APP_TAGLINE}</small></span></Link>
      <div className="library-heading"><span className="section-label">YOUR LIBRARY</span><span className="count">{documents.filter(item => !item.sample).length}</span></div>
      <button className="primary-button upload-button" onClick={() => fileInput.current?.click()} disabled={working}><Plus size={18} />Add a document</button>
      <input ref={fileInput} type="file" accept=".pdf,application/pdf" className="sr-only" aria-label="Upload a PDF" tabIndex={-1} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file);
      }} />
      <p className="upload-note">PDF files · Up to 20 MB</p>
      {processing && <div className="processing-state" role="status"><LoaderCircle size={18} className="spin" /><div><strong>Processing document</strong><span>{processing}</span><small>Uploading, indexing, and extracting relationships. This may take a minute.</small></div></div>}
      {uploadError && <div className="error-notice" role="alert"><CircleAlert size={17} /><div><p>{uploadError}</p>
        {pendingFile && <button onClick={() => void upload(pendingFile)} disabled={working}>Retry upload</button>}
        <button onClick={() => { setUploadError(""); setPendingFile(null); }}>Dismiss</button></div></div>}
      <div className="document-list">
        {documents.filter(item => !item.sample).map(document => <button key={document.id} className={"document-item" + (activeId === document.id ? " active" : "")} aria-pressed={activeId === document.id} onClick={() => chooseDocument(document)}>
          <FileText size={19} /><span><strong>{document.filename}</strong><small>{document.status === "ready" ? document.chunks_added + " passages · Ready" : document.status === "failed" ? "Processing failed" : "Processing"}</small></span>
          {document.status === "ready" ? <Check size={14} /> : <CircleAlert size={14} />}
        </button>)}
        {!libraryLoading && documents.length === 1 && <p className="library-empty">Your documents will appear here. Start with a PDF or explore the sample below.</p>}
      </div>
      <div className="sample-library"><span className="section-label">A PLACE TO START</span>
        <button className={"document-item sample-item" + (activeId === "sample" ? " active" : "")} onClick={() => { chooseDocument(SAMPLE_DOCUMENT); setTab("chat"); }} aria-pressed={activeId === "sample"}>
          <FlaskConical size={20} /><span><strong>A field guide to retrieval</strong><small>Interactive sample · No setup</small></span><ChevronRight size={16} />
        </button>
      </div>
      <div className="library-footer">
        {libraryLoading ? <p className="connection-status" role="status"><LoaderCircle size={13} className="spin" />Connecting to your library…</p>
          : libraryError ? <div className="connection-status offline"><CircleAlert size={14} /><span>Library unavailable. Sample is ready.</span><button className="icon-button" aria-label="Retry library connection" title={libraryError} onClick={() => void refreshLibrary()}><RefreshCw size={14} /></button></div>
          : <p className="connection-status"><span className="status-dot" />Library connected</p>}
        <nav aria-label="Secondary navigation"><Link href="/dashboard"><Activity size={16} />Monitoring<ArrowUpRight size={13} /></Link><Link href="/architecture"><Layers3 size={16} />Architecture<ArrowUpRight size={13} /></Link></nav>
        <p className="authorship">By {APP_AUTHOR}</p>
      </div>
    </aside>

    <main id="research-main" className="research-main">
      <header className="workspace-header"><div className="breadcrumb">Workspace<ChevronRight size={14} /><strong>{active ? (active.sample ? "Sample collection" : active.filename) : "Research"}</strong></div><span className="workspace-label"><span className="status-dot" />PERSONAL WORKSPACE</span></header>
      <div className="workspace-title"><div><span className="eyebrow">{active?.sample ? "GUIDED EXPLORATION" : "RESEARCH WORKSPACE"}</span><h1>{active ? (active.sample ? "A field guide to retrieval" : active.filename.replace(/\.pdf$/i, "")) : "Make room for your next insight."}</h1><p>{active ? "Ask a question. Explore a connection. Check the source." : "Bring your documents together and follow the evidence."}</p></div>
        {active && <div className="document-badge"><FileText size={15} />{active.sample ? "Sample" : "PDF"}<span>·</span>{active.chunks_added} passages</div>}
      </div>
      <div className="workspace-tabs" role="tablist" aria-label="Research view">
        <button id="chat-tab" role="tab" aria-selected={tab === "chat"} aria-controls="chat-panel" onClick={() => setTab("chat")}><MessageSquare size={17} />Research chat</button>
        <button id="graph-tab" role="tab" aria-selected={tab === "graph"} aria-controls="graph-panel" onClick={() => setTab("graph")}><Network size={18} />Knowledge graph{active && <span className="count">{active.graph_entities}</span>}</button>
      </div>
      {active?.sample && <div className="sample-banner"><FlaskConical size={15} /><span>Sample mode · Three prepared answers and a curated graph. Upload a PDF for live research.</span></div>}
      {active && active.status !== "ready" && <div className="workspace-notice" role="alert"><CircleAlert size={18} /><span>{active.error ?? "This document is not ready. Retry processing to continue."}</span><button disabled={working} onClick={() => void retryDocument(active)}>Retry processing</button></div>}
      {active?.status === "ready" && active.graph_status === "failed" && <div className="workspace-notice"><CircleAlert size={18} /><span>Ready to chat. Graph extraction needs a retry.</span><button disabled={working} onClick={() => void retryDocument(active)}>Retry graph</button></div>}

      {tab === "chat" ? <section id="chat-panel" role="tabpanel" aria-labelledby="chat-tab" className="chat-panel">
        <div className="chat-scroll">
          {messages.length === 0 && <div className="welcome">
            <div className="welcome-icon"><BookOpen size={27} strokeWidth={1.6} /></div>
            <h2>{active ? "Start with a good question." : "Your research starts with a source."}</h2>
            <p>{active?.sample ? "Explore how retrieval works, then open a citation to see the supporting passage." : active ? "Ask about key ideas, methods, or findings in this document. Sources will appear alongside the answer." : "Upload a paper to ask questions and map its ideas. Or get a feel for Threadmark with our ready-to-explore sample."}</p>
            {!active && <div className="welcome-actions"><button className="primary-button" onClick={() => fileInput.current?.click()} disabled={working}><Upload size={16} />Upload a PDF</button><button className="secondary-button" onClick={() => chooseDocument(SAMPLE_DOCUMENT)}><FlaskConical size={16} />Try the sample<ArrowRight size={15} /></button></div>}
            {active && <div className="suggested-questions"><span className="section-label">{active.sample ? "TRY A QUESTION" : "SUGGESTED QUESTIONS"}</span>
              {(active.sample ? SAMPLE_QUESTIONS.map(item => item.question) : ["What are the main ideas in this document?", "Which methods does this document describe?", "What limitations or open questions are mentioned?"]).map((item, index) => <button key={item} disabled={!!askingId || active.status !== "ready"} onClick={() => void ask(item)}><span className="question-number">0{index + 1}</span>{item}<ArrowUpRight size={17} /></button>)}
            </div>}
            {!active && <div className="welcome-features"><span><MessageSquare size={16} />Ask with context</span><span><Network size={16} />Explore relationships</span><span><BookOpen size={16} />Inspect sources</span></div>}
          </div>}
          {messages.map(message => <article key={message.id} className={"message " + message.role + (message.error ? " message-error" : "")}>
            <div className="message-label">{message.role === "user" ? "YOU" : message.error ? "REQUEST FAILED" : APP_NAME.toUpperCase()}{active?.sample && message.role === "assistant" && !message.error && <span>PREPARED EXAMPLE</span>}</div>
            {message.error ? <><p role="alert">{message.content}</p><button className="secondary-button" disabled={!!askingId} onClick={() => void ask(message.retryQuestion ?? "", message.id)}><RefreshCw size={15} />Retry question</button></> : message.role === "user" ? <p>{message.content}</p> : <>
              <AnswerMarkdown content={message.content} sources={message.sources} onSource={onSource} />
              {!!message.sources?.length && <div className="source-chips">{message.sources.map(source => <button key={source.id} onClick={() => onSource(source)}><FileText size={13} /><strong>{source.id}</strong>{source.section ? "Section " + source.id : "Page " + (source.page ?? "?")}<ArrowUpRight size={13} /></button>)}</div>}
              {message.request_id && <div className="feedback-actions"><span>Was this useful?</span><button className="icon-button" disabled={feedbackBusy === message.id} aria-label="Helpful answer" aria-pressed={message.feedback === 1} onClick={() => void feedback(message, 1)}><ThumbsUp size={14} /></button><button className="icon-button" disabled={feedbackBusy === message.id} aria-label="Unhelpful answer" aria-pressed={message.feedback === -1} onClick={() => void feedback(message, -1)}><ThumbsDown size={14} /></button></div>}
            </>}
          </article>)}
          {askingId === activeId && activeId && <div className="answer-loading" role="status"><LoaderCircle size={17} className="spin" />Finding passages and preparing an answer…</div>}
          {feedbackError && <p className="workspace-notice" role="alert">{feedbackError}</p>}
          {active?.sample && messages.length > 0 && <div className="sample-followups">{SAMPLE_QUESTIONS.map(item => <button key={item.question} disabled={!!askingId} onClick={() => void ask(item.question)}>{item.question}<ArrowUpRight size={14} /></button>)}</div>}
          <div ref={messagesEnd} />
        </div>
        <form className="composer" onSubmit={event => { event.preventDefault(); void ask(question); }}>
          <div className="composer-input"><textarea aria-label="Ask about the selected document" rows={2} value={question} disabled={!active || active.sample || active.status !== "ready" || !!askingId} placeholder={active?.sample ? "Choose a sample question above, or upload a PDF to ask your own." : active ? "Ask about this document…" : "Add a document to start asking questions…"} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(question); } }} /><button className="send-button" type="submit" aria-label="Send question" disabled={!question.trim() || !active || active.sample || active.status !== "ready" || !!askingId}>{askingId === activeId && activeId ? <LoaderCircle size={18} className="spin" /> : <Send size={18} />}</button></div>
          <p>Answers can be imperfect. Follow the citations and check the source.</p>
        </form>
      </section> : <section id="graph-panel" role="tabpanel" aria-labelledby="graph-tab" className="graph-panel">
        {!active ? <div className="welcome"><div className="welcome-icon"><Network size={29} /></div><h2>See the connections in your reading.</h2><p>Choose a document to explore its entities and relationships, or open the sample graph.</p><button className="primary-button" onClick={() => chooseDocument(SAMPLE_DOCUMENT)}>Explore sample graph<ArrowRight size={16} /></button></div>
          : graphState.loading ? <div className="graph-placeholder" role="status"><LoaderCircle className="spin" />Loading the knowledge graph…</div>
          : graphState.error ? <div className="welcome"><CircleAlert size={28} /><h2>The graph is unavailable.</h2><p role="alert">{graphState.error}</p><button className="secondary-button" disabled={working} onClick={() => void retryDocument(active)}><RefreshCw size={16} />Retry graph extraction</button></div>
          : graph?.nodes.length ? <><GraphViewer key={activeId} graphData={graph} selectedId={selection?.kind === "node" ? selection.node.id : undefined} onNodeClick={node => setSelection({ kind: "node", node })} /><p className="graph-footnote">{active.sample ? "A curated sample graph. Select an entity to inspect its connections and source mentions." : "Graph extraction currently covers the opening 5,000 characters. Check source mentions before relying on a relationship."}</p></>
          : <div className="welcome"><Network size={28} /><h2>No entities to display yet.</h2><p>{active.status === "ready" ? "No entities were extracted from this document. You can still use research chat." : "Finish processing the document to explore its graph."}</p><button className="secondary-button" disabled={working} onClick={() => void retryDocument(active)}><RefreshCw size={16} />Retry processing</button></div>}
      </section>}
    </main>
    {selection && <EvidencePanel selection={selection} graph={graph} onClose={() => setSelection(null)} onSource={onSource} onNode={node => setSelection({ kind: "node", node })} />}
  </div>;
}
