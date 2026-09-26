# A field guide to retrieval

By ARshagya Shrivastava · Threadmark sample document

This short educational sample is included with Threadmark. Its three guided
answers and graph are prepared examples, not live model output.

## 1. Finding relevant passages

Vector search represents a question and document passages as embeddings. It finds
passages with similar meaning, even when they use different words. Keyword search
finds explicit terms, names, and identifiers. Hybrid retrieval combines both
result lists so that exact matches and semantic matches can contribute evidence.
A reranker can reorder these candidate passages according to how well they
address the question.

## 2. Connecting information

A knowledge graph stores entities and typed relationships. For example, Hybrid
retrieval COMBINES Vector search and Keyword search. Graph traversal follows
these connections to find related concepts. Relationships should preserve their
direction and point to supporting passages. Connections are useful leads; the
graph alone does not prove that a claim is true.

## 3. Checking an answer

Citations connect an answer to its source passages. A reader should be able to
inspect the complete excerpt, identify its document, and check whether it
supports the claim. Retrieval quality and answer correctness are different:
finding relevant text does not guarantee a correct answer. If the passages do
not answer the question, the assistant should say that the evidence is
insufficient.
