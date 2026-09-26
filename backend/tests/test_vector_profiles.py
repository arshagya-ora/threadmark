from types import SimpleNamespace
from langchain_core.documents import Document
from app import vector_store, model_client
from app.model_config import ModelSettings


def test_real_chroma_separates_embedding_models_and_keeps_document_scope(tmp_path, monkeypatch):
    import litellm
    monkeypatch.setattr(vector_store, "CHROMA_PERSIST_DIR", str(tmp_path / "chroma"))
    active = ModelSettings(provider="openai", model="embed-a", api_key="test-only", dimensions=3)
    monkeypatch.setattr(vector_store, "get_model_settings", lambda role: active)
    def embed(input, **options):
        size = options["dimensions"]
        return SimpleNamespace(data=[{"index": i, "embedding": [1., float("beta" in text)] + [0.] * (size - 2)} for i, text in enumerate(input)])
    monkeypatch.setattr(litellm, "embedding", embed)
    vector_store.add_chunks_to_vector_store([Document(page_content="alpha", metadata={"document_id": "doc-a"})], "doc-a")
    vector_store.add_chunks_to_vector_store([Document(page_content="beta", metadata={"document_id": "doc-b"})], "doc-b")
    original = vector_store.get_vector_store()
    assert original._collection.count() == 2
    assert [doc.page_content for doc in original.similarity_search("beta", k=4, filter={"document_id": "doc-a"})] == ["alpha"]
    active = active.model_copy(update={"model": "embed-b", "dimensions": 4})
    replacement = vector_store.get_vector_store()
    assert replacement._collection.count() == 0
    vector_store.add_chunks_to_vector_store([Document(page_content="alpha", metadata={"document_id": "doc-a"})], "doc-a")
    assert replacement._collection.count() == 1
    assert original._collection.count() == 2
    assert replacement.similarity_search("alpha", k=1)[0].page_content == "alpha"
