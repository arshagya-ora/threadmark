"""Small local document catalog; no extra service is required."""
import json
import os
import re
import uuid
from pathlib import Path

DATA_DIR = Path(os.environ.get("THREADMARK_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))

def document_path(document_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{64}", document_id):
        raise ValueError("Invalid document ID")
    return DATA_DIR / document_id

def save_document(record: dict) -> None:
    folder = document_path(record["id"])
    folder.mkdir(parents=True, exist_ok=True)
    temporary = folder / (uuid.uuid4().hex + ".tmp")
    temporary.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    temporary.replace(folder / "document.json")

def load_document(document_id: str) -> dict:
    return json.loads((document_path(document_id) / "document.json").read_text(encoding="utf-8"))

def summary(record: dict) -> dict:
    return {k: v for k, v in record.items() if k not in {"chunks", "graph"}}

def list_documents() -> list[dict]:
    records = []
    if DATA_DIR.exists():
        for path in DATA_DIR.glob("*/document.json"):
            try:
                records.append(summary(json.loads(path.read_text(encoding="utf-8"))))
            except (OSError, ValueError):
                continue
    return sorted(records, key=lambda item: item["created_at"], reverse=True)
