"""A shared LiteLLM boundary for generation and LangChain-compatible embeddings."""
import json
import math
from langchain_core.embeddings import Embeddings
from .model_config import ModelConfigError, ModelSettings, get_model_settings

class ModelError(RuntimeError):
    """Provider failure without upstream payloads or credentials."""

def request_options(cfg: ModelSettings, *, embedding=False) -> dict:
    provider = "openai" if cfg.provider == "openai_compatible" else cfg.provider
    if provider == "ollama" and not embedding:
        provider = "ollama_chat"
    options = {"model": f"{provider}/{cfg.model}", "timeout": cfg.request_timeout,
               "num_retries": cfg.max_retries, **cfg.parameters}
    if cfg.base_url:
        options["aws_bedrock_runtime_endpoint" if provider == "bedrock" else "api_base"] = cfg.base_url
    if cfg.api_key:
        options["api_key"] = cfg.api_key.get_secret_value()
    elif cfg.provider == "openai_compatible":
        # Explicit no-auth local endpoints must not inherit an unrelated OPENAI_API_KEY.
        options["api_key"] = "not-needed"
    if provider == "vertex_ai":
        options.update(vertex_project=cfg.project_id, vertex_location=cfg.location)
        if cfg.credentials_file:
            try:
                credentials = json.loads(cfg.credentials_file.read_text(encoding="utf-8"))
                if not isinstance(credentials, dict):
                    raise ValueError()
                options["vertex_credentials"] = json.dumps(credentials)
            except (OSError, ValueError):
                raise ModelConfigError("credentials_file must contain valid Google credential JSON.") from None
    if provider == "bedrock":
        options["aws_region_name"] = cfg.region
        if cfg.aws_profile:
            options["aws_profile_name"] = cfg.aws_profile
        for field in ("aws_access_key_id", "aws_secret_access_key", "aws_session_token"):
            value = getattr(cfg, field)
            if value:
                options[field] = value.get_secret_value()
    if embedding:
        if cfg.dimensions is not None:
            options["dimensions"] = cfg.dimensions
    else:
        options.update(max_tokens=cfg.max_tokens, stream=False)
        if cfg.temperature is not None:
            options["temperature"] = cfg.temperature
        if cfg.top_p is not None:
            options["top_p"] = cfg.top_p
    return options

def generate_text(prompt: str, role="answer") -> str:
    import litellm
    options = request_options(get_model_settings(role))
    try:
        response = litellm.completion(messages=[{"role": "user", "content": prompt}], **options)
        choice = response.choices[0]
        content = choice.message.content
        if choice.finish_reason in {"length", "content_filter"}:
            raise ModelError("The model response was incomplete. Check the token limit in models.yaml and retry.")
        if not isinstance(content, str) or not content.strip():
            raise ModelError("The model returned no text. Check the selected model and retry.")
        return content
    except ModelError:
        raise
    except Exception:
        raise ModelError("The model request failed. Check the selected profile, credentials, endpoint, and supported parameters in models.yaml.") from None

class ConfiguredEmbeddings(Embeddings):
    def __init__(self, settings: ModelSettings | None = None):
        self.settings = settings or get_model_settings("embeddings")

    def _embed(self, texts: list[str], *, query=False) -> list[list[float]]:
        import litellm
        if not texts:
            return []
        cfg = self.settings
        options = request_options(cfg, embedding=True)
        options.update(cfg.query_parameters if query else cfg.document_parameters)
        vectors = []
        try:
            for start in range(0, len(texts), cfg.batch_size):
                batch = texts[start:start + cfg.batch_size]
                response = litellm.embedding(input=batch, **options)
                rows = sorted(response.data, key=lambda row: row["index"])
                if [row["index"] for row in rows] != list(range(len(batch))):
                    raise ValueError("Embedding count/order mismatch")
                for row in rows:
                    vector = row["embedding"]
                    if not isinstance(vector, list) or not vector or not all(isinstance(n, (int, float)) and math.isfinite(n) for n in vector):
                        raise ValueError("Invalid embedding")
                    if vectors and len(vector) != len(vectors[0]):
                        raise ValueError("Embedding dimensions changed")
                    if cfg.dimensions and len(vector) != cfg.dimensions:
                        raise ValueError("Unexpected embedding dimensions")
                    vectors.append(vector)
            return vectors
        except Exception:
            raise ModelError("Embedding request failed. Check the embedding model, endpoint, credentials and dimensions in models.yaml.") from None

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embed(texts)

    def embed_query(self, text: str) -> list[float]:
        return self._embed([text], query=True)[0]
