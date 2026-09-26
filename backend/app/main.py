import hashlib
import logging
import threading
import time
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import APP_NAME, APP_AUTHOR, APP_TAGLINE
from . import document_store as catalog
from .graph_store import GraphStore
from .model_config import ModelConfigError, get_model_settings
from .model_client import ModelError
from .metrics import init_db, log_request, submit_feedback, get_dashboard_metrics, update_settings

logger = logging.getLogger(__name__)
app = FastAPI(title=f"{APP_NAME} API", description=APP_TAGLINE, contact={"name": APP_AUTHOR})
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False,
                   allow_methods=["*"], allow_headers=["*"])
# A single lock keeps this local, single-process app from indexing the same upload twice.
ingestion_lock = threading.Lock()
MAX_UPLOAD_BYTES = 20 * 1024 * 1024

@app.on_event("startup")
def startup_event():
    init_db()

class QuestionRequest(BaseModel):
    question: str = Field(min_length=1, max_length=8000)
    document_id: str

class FeedbackRequest(BaseModel):
    request_id: str
    feedback: int = Field(ge=-1, le=1)

class SettingsRequest(BaseModel):
    latency_threshold: float = Field(gt=0)
    error_rate_threshold: float = Field(ge=0, le=100)
    slack_webhook: str = ""
    email_notifications: str = ""

def require_model(*roles):
    try:
        for role in roles or ("answer", "embeddings"):
            get_model_settings(role)
    except ModelConfigError as error:
        raise HTTPException(503, f"{error} You can explore the bundled sample while configuring models.") from None

def current_embedding_fingerprint():
    return get_model_settings("embeddings").embedding_fingerprint()

def ensure_document_index(record):
    """Reindex saved passages in the selected vector space before retrieval."""
    fingerprint = current_embedding_fingerprint()
    if record.get("embedding_fingerprint") == fingerprint:
        return
    from langchain_core.documents import Document
    chunks = [Document(page_content=chunk["text"], metadata={
        "document_id": record["id"], "filename": record["filename"],
        "page": max(0, chunk.get("page", 1) - 1),
    }) for chunk in record.get("chunks", [])]
    if not chunks:
        raise ModelError("No saved passages are available. Retry processing the original PDF.")
    index_chunks(chunks, record["id"])
    # Mark success only after every embedding has been stored. Old collections stay intact.
    record["embedding_fingerprint"] = fingerprint
    catalog.save_document(record)

def get_document(document_id):
    try:
        return catalog.load_document(document_id)
    except (ValueError, FileNotFoundError):
        raise HTTPException(404, "Document not found. Refresh your library.")

# Lazy imports let the library and health endpoints run without model initialization.
def parse_pdf(path):
    from .pdf_processing import extract_and_chunk_pdf
    return extract_and_chunk_pdf(str(path))

def index_chunks(chunks, document_id):
    from .vector_store import add_chunks_to_vector_store
    return add_chunks_to_vector_store(chunks, document_id=document_id)

def extract_graph(text):
    from .graph_extractor import extract_graph_from_text
    return extract_graph_from_text(text)

def run_answer(question, document_id, graph_store):
    from .rag_chain import ask_question_hybrid
    return ask_question_hybrid(question, document_id=document_id, graph_store=graph_store)

def build_graph(record):
    text = " ".join(chunk["text"] for chunk in record["chunks"])[:5000]
    store = GraphStore()
    store.add_entities_and_relations(extract_graph(text))
    graph = store.to_json()
    # These are exact-name mentions, not a claim that a passage proves every edge.
    for node in graph["nodes"]:
        name = node.get("name", "").casefold()
        node["sources"] = [chunk for chunk in record["chunks"] if name and name in chunk["text"].casefold()][:5]
    record["graph"] = graph
    record["graph_status"] = "ready" if graph["nodes"] else "empty"
    record["graph_entities"] = len(graph["nodes"])
    record["graph_relations"] = len(graph["links"])
    record["graph_error"] = None

def process_document(record):
    if record.get("status") != "ready":
        try:
            chunks = parse_pdf(catalog.document_path(record["id"]) / "document.pdf")
            if not chunks:
                raise HTTPException(422, "No readable text was found. Try a text-based PDF; scanned documents need OCR.")
            record["chunks"] = []
            for index, chunk in enumerate(chunks):
                chunk.metadata["document_id"] = record["id"]
                chunk.metadata["filename"] = record["filename"]
                record["chunks"].append({
                    "id": str(index + 1), "document_id": record["id"],
                    "filename": record["filename"], "page": int(chunk.metadata.get("page", 0)) + 1,
                    "text": chunk.page_content,
                })
            index_chunks(chunks, record["id"])
            record.update(status="ready", chunks_added=len(chunks), error=None,
                          embedding_fingerprint=current_embedding_fingerprint())
        except Exception as error:
            logger.exception("Document indexing failed")
            detail = error.detail if isinstance(error, HTTPException) else "Processing failed. Check the backend model connection and retry this document."
            record.update(status="failed", error=detail)
            catalog.save_document(record)
            if isinstance(error, HTTPException):
                raise
            raise HTTPException(503, detail) from error
    if record.get("embedding_fingerprint") != current_embedding_fingerprint():
        ensure_document_index(record)
    try:
        build_graph(record)
    except Exception:
        logger.exception("Graph extraction failed")
        record.update(graph_status="failed", graph_error="Chat is ready, but graph extraction failed. Retry the graph when the model is available.")
    catalog.save_document(record)
    return catalog.summary(record)

@app.exception_handler(ModelError)
@app.exception_handler(ModelConfigError)
def model_error_handler(request, error):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=503, content={"detail": str(error)})

@app.get("/")
def read_root():
    return {"message": f"Welcome to the {APP_NAME} API", "author": APP_AUTHOR}

@app.get("/documents")
def documents():
    return {"documents": catalog.list_documents()}

@app.post("/upload")
def upload_pdf(file: UploadFile = File(...)):
    filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Choose a PDF file.")
    payload = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "This PDF exceeds the 20 MB upload limit.")
    if not payload.startswith(b"%PDF-"):
        raise HTTPException(400, "This file is not a valid PDF.")
    require_model("embeddings")
    document_id = hashlib.sha256(payload).hexdigest()
    with ingestion_lock:
        try:
            record = catalog.load_document(document_id)
            if record["status"] == "ready":
                ensure_document_index(record)
                return catalog.summary(record)
        except FileNotFoundError:
            record = {
                "id": document_id, "filename": filename, "size": len(payload),
                "created_at": datetime.now(timezone.utc).isoformat(), "status": "processing",
                "graph_status": "pending", "chunks_added": 0, "graph_entities": 0, "graph_relations": 0,
            }
        folder = catalog.document_path(document_id)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "document.pdf").write_bytes(payload)
        catalog.save_document(record)
        return process_document(record)

@app.post("/documents/{document_id}/retry")
def retry_document(document_id: str):
    require_model("embeddings")
    with ingestion_lock:
        return process_document(get_document(document_id))

@app.get("/documents/{document_id}/graph")
def get_graph(document_id: str):
    record = get_document(document_id)
    if record.get("graph_status") == "failed":
        raise HTTPException(503, record["graph_error"])
    if record.get("status") != "ready":
        raise HTTPException(409, "This document is not ready yet.")
    return record.get("graph", {"nodes": [], "links": []})

@app.get("/documents/{document_id}/file")
def get_file(document_id: str):
    record = get_document(document_id)
    path = catalog.document_path(document_id) / "document.pdf"
    if not path.is_file():
        raise HTTPException(404, "The original PDF is unavailable.")
    return FileResponse(path, media_type="application/pdf", filename=record["filename"], content_disposition_type="inline")

@app.post("/ask")
def ask_question(request: QuestionRequest):
    if not request.question.strip():
        raise HTTPException(400, "Enter a question first.")
    record = get_document(request.document_id)
    if record.get("status") != "ready":
        raise HTTPException(409, "Process this document before asking a question.")
    require_model()
    request_id = uuid.uuid4().hex
    started = time.perf_counter()
    try:
        with ingestion_lock:
            record = get_document(request.document_id)
            ensure_document_index(record)
        store = GraphStore()
        graph = record.get("graph", {})
        store.add_entities_and_relations({
            "entities": graph.get("nodes", []), "relations": graph.get("links", []),
        })
        result = run_answer(request.question, request.document_id, store)
        sources = [{
            "id": str(index + 1), "document_id": record["id"], "filename": record["filename"],
            "page": int(doc.metadata.get("page", 0)) + 1, "text": doc.page_content,
        } for index, doc in enumerate(result.get("source_documents", []))]
        metrics = result.get("metrics", {})
        total = time.perf_counter() - started
        # A metrics failure must not discard a successfully generated answer.
        try:
            log_request(request_id, request.question, result["result"], metrics.get("retrieval_latency", 0),
                        metrics.get("llm_latency", 0), total, metrics.get("relevance_score"), "success")
        except Exception:
            logger.exception("Could not record request metrics")
        return {"request_id": request_id, "answer": result["result"], "sources": sources,
                "metrics": {**metrics, "total_latency": total}}
    except (ModelError, ModelConfigError) as error:
        raise HTTPException(503, str(error)) from None
    except Exception as error:
        logger.exception("Answer generation failed")
        raise HTTPException(503, "Could not generate an answer. Check the model connection and retry your question.") from error

@app.post("/feedback")
def receive_feedback(request: FeedbackRequest):
    submit_feedback(request.request_id, request.feedback)
    return {"status": "success"}

@app.get("/metrics")
def get_metrics():
    return get_dashboard_metrics()

@app.post("/metrics/settings")
def update_metrics_settings(request: SettingsRequest):
    update_settings(request.model_dump())
    return {"status": "success"}
