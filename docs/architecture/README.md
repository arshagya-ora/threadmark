# Threadmark runtime architecture

[Interactive HTML](runtime-overview.html) · [Archify source](runtime-overview.architecture.json) · [README preview](../images/runtime-architecture.png)

Download the standalone HTML and open it locally. The preview includes the diagram and three supporting cards. Green arrows show the main question path; dashed pink outlines mark the browser, local backend and configured model endpoint boundaries. The answer returns along the same path rather than adding duplicate return edges.

## Code evidence

Inspected application revision: `6e58987eb4633579b88ef3794885a5fe03884716`.

| Runtime component | Source | What the diagram represents |
| --- | --- | --- |
| Research workspace | [`page.tsx`](../../frontend/src/app/page.tsx), [`api.ts`](../../frontend/src/lib/api.ts) | Document library, chat, graph and HTTP API calls. |
| Research API | [`main.py`](../../backend/app/main.py) | Upload validation, ingestion orchestration, question handling and response sources. |
| Hybrid retrieval | [`rag_chain.py`](../../backend/app/rag_chain.py), [`hybrid_retriever.py`](../../backend/app/hybrid_retriever.py), [`graph_store.py`](../../backend/app/graph_store.py) | Four vector-retrieved passages plus graph-neighbor context; NetworkX graph traversal. |
| Document catalog and vector store | [`document_store.py`](../../backend/app/document_store.py), [`vector_store.py`](../../backend/app/vector_store.py) | Local PDFs, passage metadata and graph snapshots; persistent Chroma collections by embedding profile. |
| Models and graph extraction | [`model_client.py`](../../backend/app/model_client.py), [`model_config.py`](../../backend/app/model_config.py), [`graph_extractor.py`](../../backend/app/graph_extractor.py) | Role-specific provider calls and graph extraction. |
| Request monitoring | [`metrics.py`](../../backend/app/metrics.py) | SQLite request measurements, settings and feedback. |

The research pipeline groups ingestion, retrieval and graph processing. The diagram highlights a question request; the ingestion and embedding paths are explained in cards. Model endpoints can be hosted providers or local services, depending on configuration. Their boundary denotes data leaving the application process, not necessarily the machine.

The API has no user authentication and is intended for local single-user use. Model prompts can contain document text. The bundled sample is an independent frontend path with prepared answers and a curated graph; it is not evidence of a live model call. The sample teaches keyword search and reranking, while the implemented backend combines vector retrieval with keyword-based graph matching; it does not run a separate passage keyword index or reranker.

## Validation receipt

Generated with Archify 2.17, diagram type `architecture`.

| Check | Result |
| --- | --- |
| Deterministic delivery | 9/9 showcase checks; 0 errors; 0 warnings |
| Automated browser evidence | Passed at 1440×900, 1600×1000, 1920×1080 and 2048×1320 |
| Perceptual review | Passed after inspecting light/dark captures and the README preview |
| Focused geometry corrections | 1 round: placed two vertical-edge labels using validator diagnostics |

Specification SHA-256: `14116c526fad2e402cb694ffaf8e6727bde0d193bc1ed6d0f22066b4b62c7a82` (4,860 bytes).

HTML SHA-256: `0cc0832ec680992ecc4601405f330451615e0e2cea1935c15abd1ca11581708d` (808,720 bytes).

The deterministic receipt validates artifact structure and composition. Browser checks establish containment and captures; visual review is a separate inspection. The source and HTML are frozen at the hashes above.

To regenerate using an installed Archify skill, run its CLI from this directory:

```sh
node /path/to/archify/bin/archify.mjs validate architecture runtime-overview.architecture.json --quality showcase --json
node /path/to/archify/bin/archify.mjs deliver architecture runtime-overview.architecture.json runtime-overview.html --quality showcase --json
node /path/to/archify/bin/archify.mjs visual-check runtime-overview.html --json
```

Recapture the README preview after updating the diagram. The PNG is a browser capture of the delivered viewer's title, diagram and cards; only viewer controls are excluded from the capture.
