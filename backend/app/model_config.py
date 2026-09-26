"""Named YAML profiles; resolve credentials only for the role being used."""
import hashlib
import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError, model_validator

BACKEND = Path(__file__).resolve().parents[1]
ENV_REFERENCE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")
Role = Literal["answer", "graph", "embeddings"]

class ModelConfigError(ValueError):
    """Configuration error safe to show without secret values."""

class ModelSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    provider: Literal["openai", "openai_compatible", "anthropic", "nvidia_nim", "ollama", "gemini", "vertex_ai", "bedrock", "cohere"]
    model: str = Field(min_length=1)
    base_url: str | None = None
    api_key: SecretStr | None = None
    project_id: str | None = None
    location: str | None = None
    credentials_file: Path | None = None
    region: str | None = None
    aws_profile: str | None = None
    aws_access_key_id: SecretStr | None = None
    aws_secret_access_key: SecretStr | None = None
    aws_session_token: SecretStr | None = None
    request_timeout: float = Field(default=60, gt=0)
    max_retries: int = Field(default=1, ge=0, le=5)
    max_tokens: int = Field(default=1024, gt=0)
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, gt=0, le=1)
    parameters: dict = Field(default_factory=dict, repr=False)
    dimensions: int | None = Field(default=None, gt=0)
    batch_size: int = Field(default=32, ge=1, le=256)
    document_parameters: dict = Field(default_factory=dict, repr=False)
    query_parameters: dict = Field(default_factory=dict, repr=False)

    @model_validator(mode="after")
    def check_provider(self):
        if not self.model.strip():
            raise ValueError("model must not be blank")
        if self.base_url:
            url = urlsplit(self.base_url)
            if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment:
                raise ValueError("base_url must be an HTTP(S) URL without credentials, query or fragment")
        if self.provider in {"openai_compatible", "ollama"} and not self.base_url:
            raise ValueError("This provider requires base_url")
        if self.provider == "vertex_ai" and (not self.project_id or not self.location):
            raise ValueError("vertex_ai requires project_id and location")
        if self.provider == "bedrock" and not self.region:
            raise ValueError("bedrock requires region")
        cloud = {"project_id", "location", "credentials_file"}
        aws = {"region", "aws_profile", "aws_access_key_id", "aws_secret_access_key", "aws_session_token"}
        wrong = (cloud if self.provider != "vertex_ai" else set()) | (aws if self.provider != "bedrock" else set())
        if any(getattr(self, field) is not None for field in wrong):
            raise ValueError("Cloud settings must match the provider")
        if self.provider == "vertex_ai" and self.api_key:
            raise ValueError("Vertex uses Google credentials, not api_key")
        if bool(self.aws_access_key_id) != bool(self.aws_secret_access_key):
            raise ValueError("Supply both AWS access keys")
        if self.aws_session_token and not self.aws_access_key_id:
            raise ValueError("Explicit session token requires access keys")
        if self.aws_profile and (self.aws_access_key_id or self.api_key):
            raise ValueError("Choose one AWS authentication method")
        if self.api_key and self.aws_access_key_id:
            raise ValueError("Choose one AWS authentication method")
        if self.api_key and self.api_key.get_secret_value().strip() in {"", "replace_with_your_own_key"}:
            raise ValueError("Replace the placeholder API key")
        if self.provider in {"openai", "anthropic", "nvidia_nim", "gemini", "cohere"} and not self.api_key:
            raise ValueError("This provider requires api_key")
        reserved = set(type(self).model_fields) | {"api_base", "timeout", "num_retries", "messages", "input", "stream", "custom_llm_provider", "encoding_format"}
        for params in (self.parameters, self.document_parameters, self.query_parameters):
            if reserved.intersection(params) or any(str(key).startswith(("aws_", "vertex_")) for key in params):
                raise ValueError("Parameters cannot override connection or application settings")
        return self

    def embedding_fingerprint(self) -> str:
        # Credentials and batching do not change vector space. Model, deployment,
        # dimensions, and input transformations do, even with equal-sized vectors.
        identity = {key: getattr(self, key) for key in (
            "provider", "model", "base_url", "project_id", "location", "region", "dimensions",
            "parameters", "document_parameters", "query_parameters",
        )}
        return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:24]


def _resolve(value):
    if isinstance(value, str):
        def substitute(match):
            result = os.environ.get(match[1])
            if not result:
                raise ModelConfigError(f"Missing environment variable: {match[1]}")
            return result
        return ENV_REFERENCE.sub(substitute, value)
    if isinstance(value, dict):
        return {key: _resolve(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_resolve(item) for item in value]
    return value

@lru_cache(maxsize=1)
def _read_config():
    load_dotenv(BACKEND / ".env", override=False)
    path = Path(os.getenv("THREADMARK_MODEL_CONFIG", BACKEND / "models.yaml")).expanduser().resolve()
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8-sig"))
    except (OSError, yaml.YAMLError):
        raise ModelConfigError("Cannot read model YAML. Check THREADMARK_MODEL_CONFIG and YAML syntax.") from None
    allowed = {"active_profile", "graph_profile", "active_embedding_profile", "defaults", "graph_defaults", "embedding_defaults", "profiles", "embedding_profiles"}
    if not isinstance(raw, dict) or set(raw) - allowed:
        raise ModelConfigError("Invalid model YAML fields. See docs/model-configuration.md.")
    return raw, path

@lru_cache(maxsize=3)
def get_model_settings(role: Role = "answer") -> ModelSettings:
    if role not in {"answer", "graph", "embeddings"}:
        raise ModelConfigError("Unknown model role")
    raw, path = _read_config()
    embedding = role == "embeddings"
    profiles = raw.get("embedding_profiles" if embedding else "profiles")
    selected = raw.get("active_embedding_profile" if embedding else "active_profile")
    if role == "graph":
        selected = raw.get("graph_profile") or selected
    defaults = raw.get("embedding_defaults" if embedding else "defaults", {})
    override = raw.get("graph_defaults", {}) if role == "graph" else {}
    if not isinstance(profiles, dict) or not isinstance(selected, str) or selected not in profiles:
        raise ModelConfigError(f"Select a valid {role} profile in backend/models.yaml.")
    if not all(isinstance(item, dict) for item in (defaults, override, profiles[selected])):
        raise ModelConfigError("Profiles and defaults must be YAML mappings.")
    try:
        cfg = ModelSettings.model_validate(_resolve({**defaults, **profiles[selected], **override}))
        if embedding and cfg.provider == "anthropic":
            raise ModelConfigError("Anthropic chat models cannot embed documents. Select an embedding provider separately.")
        # Verify JSON-safe provider parameters without including values in errors.
        json.dumps((cfg.parameters, cfg.document_parameters, cfg.query_parameters))
    except (ValidationError, TypeError, ValueError) as exc:
        if isinstance(exc, ModelConfigError):
            raise
        raise ModelConfigError(f"Invalid {role} profile settings. Check backend/models.yaml and docs/model-configuration.md.") from None
    if cfg.credentials_file:
        file = cfg.credentials_file.expanduser()
        cfg.credentials_file = (file if file.is_absolute() else path.parent / file).resolve()
        if not cfg.credentials_file.is_file():
            raise ModelConfigError("credentials_file does not exist.")
    return cfg

def clear_model_config_cache():
    """For tests/CLI. Running servers load changes after restart."""
    get_model_settings.cache_clear()
    _read_config.cache_clear()
