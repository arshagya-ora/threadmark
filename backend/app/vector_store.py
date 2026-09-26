from pathlib import Path
from langchain_community.vectorstores import Chroma
from .model_client import ConfiguredEmbeddings
from .model_config import get_model_settings

CHROMA_PERSIST_DIR = str(Path(__file__).resolve().parents[1] / "chroma_db")

def embedding_fingerprint():
    return get_model_settings("embeddings").embedding_fingerprint()

def get_vector_store():
    settings = get_model_settings("embeddings")
    return Chroma(
        collection_name="threadmark_" + settings.embedding_fingerprint(),
        embedding_function=ConfiguredEmbeddings(settings),
        persist_directory=CHROMA_PERSIST_DIR,
    )

def add_chunks_to_vector_store(chunks, document_id=None):
    vector_store = get_vector_store()
    ids = [f"{document_id}:{index}" for index in range(len(chunks))] if document_id else None
    vector_store.add_documents(chunks, ids=ids)
    return vector_store
