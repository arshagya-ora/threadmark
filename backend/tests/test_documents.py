from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from app import main, document_store

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(document_store, "DATA_DIR", tmp_path)
    monkeypatch.setenv("NVIDIA_API_KEY", "test-only")
    monkeypatch.setattr(main, "init_db", lambda: None)
    monkeypatch.setattr(main, "log_request", lambda *args, **kwargs: None)
    monkeypatch.setattr(main, "parse_pdf", lambda path: [
        SimpleNamespace(page_content="Vector search finds passages. Hybrid retrieval combines vector search.", metadata={"page": 2})
    ])
    monkeypatch.setattr(main, "index_chunks", lambda chunks, document_id: None)
    monkeypatch.setattr(main, "extract_graph", lambda text: {
        "entities": [{"id": "a", "name": "Vector search", "type": "Method"},
                     {"id": "b", "name": "Hybrid retrieval", "type": "Method"}],
        "relations": [{"source": "b", "target": "a", "type": "COMBINES"}],
    })
    with TestClient(main.app) as test_client:
        yield test_client

def upload(client, content=b"%PDF-1.4 test", name="paper.pdf"):
    return client.post("/upload", files={"file": (name, content, "application/pdf")})

def test_library_graph_and_pdf_survive_memory_reset(client):
    response = upload(client)
    assert response.status_code == 200
    document = response.json()
    assert document["status"] == "ready"
    assert document["graph_status"] == "ready"
    assert client.get("/documents").json()["documents"][0]["id"] == document["id"]
    graph = client.get(f"/documents/{document['id']}/graph").json()
    assert graph["links"][0] == {"source": "b", "target": "a", "type": "COMBINES"}
    assert graph["nodes"][0]["sources"][0]["page"] == 3
    assert client.get(f"/documents/{document['id']}/file").content == b"%PDF-1.4 test"
    with TestClient(main.app) as restarted:
        assert restarted.get(f"/documents/{document['id']}/graph").json() == graph

def test_graph_failure_is_partial_success_and_retry_skips_indexing(client, monkeypatch):
    calls = []
    monkeypatch.setattr(main, "index_chunks", lambda chunks, document_id: calls.append(document_id))
    monkeypatch.setattr(main, "extract_graph", lambda text: (_ for _ in ()).throw(RuntimeError("provider timeout")))
    document = upload(client).json()
    assert document["status"] == "ready"
    assert document["graph_status"] == "failed"
    assert client.get(f"/documents/{document['id']}/graph").status_code == 503
    monkeypatch.setattr(main, "extract_graph", lambda text: {"entities": [], "relations": []})
    retry = client.post(f"/documents/{document['id']}/retry")
    assert retry.json()["graph_status"] == "empty"
    assert len(calls) == 1

def test_duplicate_upload_does_not_reindex(client, monkeypatch):
    calls = []
    monkeypatch.setattr(main, "index_chunks", lambda chunks, document_id: calls.append(document_id))
    first = upload(client).json()
    second = upload(client, name="renamed.pdf").json()
    assert first["id"] == second["id"]
    assert len(calls) == 1
    assert len(client.get("/documents").json()["documents"]) == 1

def test_same_filename_different_contents_get_separate_documents(client):
    first = upload(client, b"%PDF-1.4 first").json()
    second = upload(client, b"%PDF-1.4 second").json()
    assert first["id"] != second["id"]
    assert len(client.get("/documents").json()["documents"]) == 2

def test_no_text_is_422_and_retry_can_recover(client, monkeypatch):
    monkeypatch.setattr(main, "parse_pdf", lambda path: [])
    response = upload(client)
    assert response.status_code == 422
    assert "readable text" in response.json()["detail"]
    document = client.get("/documents").json()["documents"][0]
    assert document["status"] == "failed"
    monkeypatch.setattr(main, "parse_pdf", lambda path: [
        SimpleNamespace(page_content="Vector search.", metadata={"page": 0})
    ])
    assert client.post(f"/documents/{document['id']}/retry").json()["status"] == "ready"

def test_citations_use_selected_document_and_actual_page(client, monkeypatch):
    document = upload(client).json()
    def answer(question, document_id, graph_store):
        assert document_id == document["id"]
        return {"result": "**Answer** [1]", "source_documents": [
            SimpleNamespace(page_content="Supporting passage.", metadata={"page": 6})
        ]}
    monkeypatch.setattr(main, "run_answer", answer)
    response = client.post("/ask", json={"question": "What is retrieval?", "document_id": document["id"]})
    assert response.status_code == 200
    assert response.json()["sources"] == [{
        "id": "1", "document_id": document["id"], "filename": "paper.pdf",
        "page": 7, "text": "Supporting passage.",
    }]

def test_invalid_files_missing_documents_and_blank_questions(client):
    assert upload(client, b"not a pdf").status_code == 400
    assert upload(client, name="paper.txt").status_code == 400
    assert client.get("/documents/not-an-id/graph").status_code == 404
    assert client.post("/ask", json={"question": " ", "document_id": "missing"}).status_code == 400

def test_missing_provider_configuration_is_actionable(client, monkeypatch):
    monkeypatch.delenv("NVIDIA_API_KEY")
    response = upload(client)
    assert response.status_code == 503
    assert "sample" in response.json()["detail"]

def test_model_failure_can_be_retried_without_losing_document(client, monkeypatch):
    document = upload(client).json()
    monkeypatch.setattr(main, "run_answer", lambda *args: (_ for _ in ()).throw(RuntimeError("offline")))
    response = client.post("/ask", json={"question": "Question?", "document_id": document["id"]})
    assert response.status_code == 503
    assert "retry" in response.json()["detail"]
    assert client.get("/documents").json()["documents"][0]["status"] == "ready"


def test_embedding_switch_reindexes_saved_passages_before_answer(client, monkeypatch):
    document = upload(client).json()
    old = document_store.load_document(document["id"])["embedding_fingerprint"]
    calls = []
    monkeypatch.setattr(main, "current_embedding_fingerprint", lambda: "new-vector-space")
    monkeypatch.setattr(main, "index_chunks", lambda chunks, document_id: calls.append((chunks, document_id)))
    def answer(*args):
        assert document_store.load_document(document["id"])["embedding_fingerprint"] == "new-vector-space"
        return {"result": "Answer", "source_documents": []}
    monkeypatch.setattr(main, "run_answer", answer)
    payload = {"question": "Question?", "document_id": document["id"]}
    assert client.post("/ask", json=payload).status_code == 200
    assert client.post("/ask", json=payload).status_code == 200
    assert len(calls) == 1
    assert calls[0][0][0].metadata["page"] == 2
    assert calls[0][0][0].metadata["document_id"] == document["id"]
    assert old != "new-vector-space"


def test_failed_reindex_keeps_previous_index_marker(client, monkeypatch):
    from app.model_client import ModelError
    document = upload(client).json()
    old = document_store.load_document(document["id"])["embedding_fingerprint"]
    monkeypatch.setattr(main, "current_embedding_fingerprint", lambda: "new-vector-space")
    monkeypatch.setattr(main, "index_chunks", lambda *args: (_ for _ in ()).throw(ModelError("Embedding unavailable")))
    response = client.post("/ask", json={"question": "Question?", "document_id": document["id"]})
    assert response.status_code == 503
    assert document_store.load_document(document["id"])["embedding_fingerprint"] == old


def test_legacy_document_without_index_marker_is_reindexed(client, monkeypatch):
    document = upload(client).json()
    record = document_store.load_document(document["id"])
    record.pop("embedding_fingerprint")
    document_store.save_document(record)
    calls = []
    monkeypatch.setattr(main, "index_chunks", lambda *args: calls.append(args))
    assert upload(client).status_code == 200
    assert len(calls) == 1
    assert document_store.load_document(document["id"])["embedding_fingerprint"]
