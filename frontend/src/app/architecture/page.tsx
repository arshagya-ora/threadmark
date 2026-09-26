import Link from "next/link";
import { ArrowLeft, FileText, Layers3, MessageSquare, Network } from "lucide-react";
import { APP_AUTHOR } from "@/lib/config";
export const metadata = { title: "Architecture" };
export default function Architecture() {
  return <main className="architecture-page"><Link href="/" className="back-link"><ArrowLeft size={17} />Back to workspace</Link>
    <span className="eyebrow">BEHIND THE WORKSPACE</span><h1>How Threadmark works</h1>
    <p className="architecture-intro">A small, focused application for reading documents, asking questions, and exploring connected ideas.</p>
    <div className="architecture-steps">
      <section><FileText /><div><h2>1. Add a document</h2><p>The FastAPI backend reads a PDF, splits its text into passages, and indexes embeddings in ChromaDB. A local document catalog keeps the PDF, metadata, and graph available after a restart.</p></div></section>
      <section><MessageSquare /><div><h2>2. Ask with context</h2><p>Relevant passages and graph connections are passed to the answer model. Numbered source passages are returned alongside the answer so you can inspect the supporting text.</p></div></section>
      <section><Network /><div><h2>3. Explore the graph</h2><p>NetworkX stores extracted entities and directed relationships. The interface lets you search, filter, and inspect those connections. Source mentions are matched by entity name; they are not automatic verification of a relationship.</p></div></section>
      <section><Layers3 /><div><h2>A deliberately simple stack</h2><p>Next.js and React on the frontend. FastAPI, ChromaDB, NetworkX, local files, and SQLite metrics on the backend. Answer generation, graph extraction, and embeddings use independently configurable model profiles. Hosted APIs and local model servers are supported through the backend YAML configuration.</p></div></section>
    </div>
    <div className="architecture-limitations"><h2>Current boundaries</h2><p>Graph extraction covers the opening 5,000 characters. Scanned PDFs need OCR and are not yet supported. The library is designed for a local, single-user backend. Sample answers and the sample graph are prepared examples that work without a backend. Chats last for the current browser session.</p></div>
    <footer>Threadmark · By {APP_AUTHOR}</footer>
  </main>;
}
