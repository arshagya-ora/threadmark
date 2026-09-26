import json
import pytest
import yaml
from app import model_config as config
from app.model_client import request_options


def write_config(tmp_path, monkeypatch, **overrides):
    raw = {"active_profile": "a", "active_embedding_profile": "e",
           "profiles": {"a": {"provider": "openai", "model": "chat-test", "api_key": "test-only"}},
           "embedding_profiles": {"e": {"provider": "openai", "model": "embed-test", "api_key": "test-only"}}}
    raw.update(overrides)
    path = tmp_path / "models.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    monkeypatch.setenv("THREADMARK_MODEL_CONFIG", str(path))
    config.clear_model_config_cache()
    return path


def test_roles_defaults_and_only_selected_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_TEST_KEY", "secret-test-value")
    write_config(tmp_path, monkeypatch, profiles={
        "a": {"provider": "openai", "model": "chat", "api_key": "${MODEL_TEST_KEY}", "max_tokens": 200},
        "g": {"provider": "ollama", "model": "graph", "base_url": "http://localhost:11434"},
        "unused": {"api_key": "${MISSING_UNUSED_KEY}"}},
        graph_profile="g", defaults={"max_tokens": 100, "request_timeout": 20}, graph_defaults={"max_tokens": 500})
    answer = config.get_model_settings("answer")
    graph = config.get_model_settings("graph")
    assert (answer.max_tokens, graph.max_tokens, graph.model) == (200, 500, "graph")
    assert config.get_model_settings("embeddings").model == "embed-test"
    assert "secret-test-value" not in repr(answer)
    assert answer.api_key.get_secret_value() == "secret-test-value"


def test_graph_reuses_chat_and_settings_stay_stable_until_restart(tmp_path, monkeypatch):
    path = write_config(tmp_path, monkeypatch)
    assert config.get_model_settings("graph").model == "chat-test"
    raw = yaml.safe_load(path.read_text())
    raw["profiles"]["a"]["model"] = "changed"
    path.write_text(yaml.safe_dump(raw))
    assert config.get_model_settings("answer").model == "chat-test"
    config.clear_model_config_cache()
    assert config.get_model_settings("answer").model == "changed"


def test_missing_env_and_invalid_configuration_do_not_leak_secrets(tmp_path, monkeypatch):
    monkeypatch.delenv("MISSING_MODEL_TEST_ENV", raising=False)
    write_config(tmp_path, monkeypatch, profiles={"a": {"provider": "openai", "model": "x", "api_key": "${MISSING_MODEL_TEST_ENV}"}})
    with pytest.raises(config.ModelConfigError, match="MISSING_MODEL_TEST_ENV"):
        config.get_model_settings()
    write_config(tmp_path, monkeypatch, profiles={"a": {"provider": "typo", "model": "x", "api_key": "private-test-value"}})
    with pytest.raises(config.ModelConfigError) as error:
        config.get_model_settings()
    assert "private-test-value" not in str(error.value)


@pytest.mark.parametrize("text", ["[]", "profiles: [", "!!python/object:os.system {}", "active_profile: absent\nprofiles: {}", "unknown: x"])
def test_bad_yaml(tmp_path, monkeypatch, text):
    path = write_config(tmp_path, monkeypatch)
    path.write_text(text)
    with pytest.raises(config.ModelConfigError):
        config.get_model_settings()


@pytest.mark.parametrize("extra", [
    {"provider": "openai_compatible"}, {"provider": "vertex_ai"}, {"provider": "bedrock"},
    {"max_tokens": 0}, {"base_url": "https://user:secret@example.com"}, {"base_url": "https://host/v1?key=secret"},
    {"parameters": {"api_key": "secret"}}, {"region": "wrong-provider"},
    {"api_key": "replace_with_your_own_key"}, {"provider": "bedrock", "region": "us-east-1", "aws_access_key_id": "incomplete"},
])
def test_invalid_settings(extra):
    with pytest.raises(ValueError):
        config.ModelSettings(**({"provider": "openai", "model": "x", "api_key": "test-only"} | extra))


@pytest.mark.parametrize("provider,extra,expected", [
    ("openai", {"api_key": "k"}, {"model": "openai/example"}),
    ("openai_compatible", {"base_url": "http://localhost:1234/v1"}, {"model": "openai/example", "api_key": "not-needed"}),
    ("nvidia_nim", {"api_key": "k"}, {"model": "nvidia_nim/example"}),
    ("anthropic", {"api_key": "k"}, {"model": "anthropic/example"}),
    ("gemini", {"api_key": "k"}, {"model": "gemini/example"}),
    ("ollama", {"base_url": "http://localhost:11434"}, {"model": "ollama_chat/example"}),
    ("vertex_ai", {"project_id": "p", "location": "global"}, {"vertex_project": "p", "vertex_location": "global"}),
    ("bedrock", {"region": "us-east-1", "aws_profile": "dev"}, {"aws_region_name": "us-east-1", "aws_profile_name": "dev"}),
])
def test_provider_request_mapping(provider, extra, expected):
    cfg = config.ModelSettings(provider=provider, model="example", **extra)
    options = request_options(cfg)
    assert expected.items() <= options.items()
    assert options["stream"] is False
    assert "temperature" not in options
    assert "max_tokens" not in request_options(cfg, embedding=True)


def test_embedding_identity_ignores_credentials_and_chat_settings():
    cfg = config.ModelSettings(provider="openai", model="embed", api_key="one")
    identity = cfg.embedding_fingerprint()
    assert cfg.model_copy(update={"api_key": "two", "max_tokens": 500, "batch_size": 8}).embedding_fingerprint() == identity
    for changes in ({"model": "other"}, {"dimensions": 128}, {"base_url": "http://localhost/v1"}, {"query_parameters": {"input_type": "query"}}):
        assert cfg.model_copy(update=changes).embedding_fingerprint() != identity


def test_relative_google_credentials(tmp_path, monkeypatch):
    (tmp_path / "credential.json").write_text(json.dumps({"type": "service_account"}))
    write_config(tmp_path, monkeypatch, profiles={"a": {"provider": "vertex_ai", "model": "gemini-test", "project_id": "p", "location": "global", "credentials_file": "credential.json"}})
    assert json.loads(request_options(config.get_model_settings())["vertex_credentials"])["type"] == "service_account"


def test_anthropic_is_not_an_embedding_provider(tmp_path, monkeypatch):
    write_config(tmp_path, monkeypatch, embedding_profiles={"e": {"provider": "anthropic", "model": "claude", "api_key": "test-only"}})
    with pytest.raises(config.ModelConfigError, match="cannot embed"):
        config.get_model_settings("embeddings")
