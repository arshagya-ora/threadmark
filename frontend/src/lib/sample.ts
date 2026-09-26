import type { GraphData, ResearchDocument, Source } from "./types";

export const SAMPLE_DOCUMENT: ResearchDocument = {
  id: "sample", filename: "A field guide to retrieval.md", sample: true,
  size: 2600, status: "ready", graph_status: "ready", chunks_added: 3,
  graph_entities: 7, graph_relations: 7, created_at: "2026-09-26T00:00:00Z",
};

export const SAMPLE_SOURCES: Source[] = [
  { id: "1", document_id: "sample", filename: SAMPLE_DOCUMENT.filename, section: "1. Finding relevant passages",
    text: "Vector search represents a question and document passages as embeddings. It finds passages with similar meaning, even when they use different words. Keyword search finds explicit terms, names, and identifiers. Hybrid retrieval combines both result lists so that exact matches and semantic matches can contribute evidence. A reranker can reorder these candidate passages according to how well they address the question." },
  { id: "2", document_id: "sample", filename: SAMPLE_DOCUMENT.filename, section: "2. Connecting information",
    text: "A knowledge graph stores entities and typed relationships. For example, Hybrid retrieval COMBINES Vector search and Keyword search. Graph traversal follows these connections to find related concepts. Relationships should preserve their direction and point to supporting passages. Connections are useful leads; the graph alone does not prove that a claim is true." },
  { id: "3", document_id: "sample", filename: SAMPLE_DOCUMENT.filename, section: "3. Checking an answer",
    text: "Citations connect an answer to its source passages. A reader should be able to inspect the complete excerpt, identify its document, and check whether it supports the claim. Retrieval quality and answer correctness are different: finding relevant text does not guarantee a correct answer. If the passages do not answer the question, the assistant should say that the evidence is insufficient." },
];

export const SAMPLE_QUESTIONS = [
  { question: "How do vector and keyword search work together?",
    answer: "## Two complementary ways to search\n\n**Vector search** finds similar meaning, while **keyword search** finds exact terms, names, and identifiers. Hybrid retrieval combines their candidate passages. [1]\n\n| Method | Useful for |\n| --- | --- |\n| Vector search | Related meaning and different wording |\n| Keyword search | Exact names and identifiers |\n\nA **reranker** can then reorder those passages by how well they address the question. [1]",
    sources: [SAMPLE_SOURCES[0]] },
  { question: "What does the knowledge graph add?",
    answer: "## Explore how concepts connect\n\nA knowledge graph represents **entities and typed relationships**. For example:\n\n- Hybrid retrieval **COMBINES** Vector search.\n- Hybrid retrieval **COMBINES** Keyword search.\n\nFollowing these connections can reveal related concepts. Relationships should retain their direction and link back to source passages. [2]\n\n> A connection is a useful lead, not proof that a claim is true. Check the source.",
    sources: [SAMPLE_SOURCES[1]] },
  { question: "How can I check whether an answer is supported?",
    answer: "## Follow the evidence\n\n1. Open the answer's citation.\n2. Read the **complete source passage**.\n3. Check that the passage supports the specific claim.\n\nRelevant passages do not automatically mean the answer is correct. When evidence is insufficient, the assistant should say so. [3]",
    sources: [SAMPLE_SOURCES[2]] },
];

export const SAMPLE_GRAPH: GraphData = {
  nodes: [
    { id: "hybrid", name: "Hybrid retrieval", type: "Method", sources: [SAMPLE_SOURCES[0], SAMPLE_SOURCES[1]] },
    { id: "vector", name: "Vector search", type: "Method", sources: [SAMPLE_SOURCES[0], SAMPLE_SOURCES[1]] },
    { id: "keyword", name: "Keyword search", type: "Method", sources: [SAMPLE_SOURCES[0], SAMPLE_SOURCES[1]] },
    { id: "reranker", name: "Reranker", type: "Method", sources: [SAMPLE_SOURCES[0]] },
    { id: "graph", name: "Knowledge graph", type: "Concept", sources: [SAMPLE_SOURCES[1]] },
    { id: "passages", name: "Source passages", type: "Evidence", sources: [SAMPLE_SOURCES[0], SAMPLE_SOURCES[2]] },
    { id: "citations", name: "Citations", type: "Evidence", sources: [SAMPLE_SOURCES[2]] },
  ],
  links: [
    { source: "hybrid", target: "vector", type: "COMBINES" },
    { source: "hybrid", target: "keyword", type: "COMBINES" },
    { source: "hybrid", target: "passages", type: "RETRIEVES" },
    { source: "reranker", target: "passages", type: "RANKS" },
    { source: "graph", target: "hybrid", type: "DESCRIBES" },
    { source: "graph", target: "passages", type: "LINKS_TO" },
    { source: "citations", target: "passages", type: "REFERENCES" },
  ],
};
