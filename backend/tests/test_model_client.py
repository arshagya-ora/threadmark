"""Exercise the real provider adapters with HTTP/auth mocked; no paid calls."""
import json
from types import SimpleNamespace

import httpx
import pytest
from app import model_client
from app.model_config import ModelSettings

@pytest.fixture
def provider_transport(monkeypatch):
    import litellm
    import litellm.llms.custom_httpx.http_handler as handler
    monkeypatch.setattr(litellm, "telemetry", False)
    monkeypatch.setattr(litellm, "suppress_debug_info", True)
    requests = []
    def install(responder):
        def send(client, request, **kwargs):
            assert request.url.host == "provider.test", "Unexpected outbound request"
            payload = json.loads(request.content)
            requests.append(payload)
            return httpx.Response(200, json=responder(payload), request=request)
        monkeypatch.setattr(httpx.Client, "send", send)
        monkeypatch.setattr(handler.httpx.Client, "send", send)
        return requests
    return install

@pytest.mark.parametrize("provider,model,extra", [
    ("openai", "gpt-4o-mini", {"api_key": "test-only"}),
    ("openai_compatible", "custom-chat", {}),
    ("nvidia_nim", "meta/llama-3.1-8b-instruct", {"api_key": "test-only"}),
    ("anthropic", "claude-sonnet-4-20250514", {"api_key": "test-only"}),
    ("ollama", "llama3.1", {}),
    ("gemini", "gemini-2.5-flash", {"api_key": "test-only"}),
    ("vertex_ai", "gemini-2.5-flash", {"project_id": "test-project", "location": "us-central1"}),
    ("bedrock", "anthropic.claude-3-5-sonnet-20240620-v1:0", {"region": "us-east-1", "api_key": "test-only"}),
])
def test_generation_protocols(monkeypatch, provider_transport, provider, model, extra):
    if provider == "vertex_ai":
        import google.auth
        from google.oauth2.credentials import Credentials
        monkeypatch.setattr(Credentials, "refresh", lambda self, request: None)
        monkeypatch.setattr(google.auth, "default", lambda **kwargs: (Credentials(token="test-only"), "test-project"))
    cfg = ModelSettings(provider=provider, model=model, base_url="https://provider.test/v1", max_retries=0, **extra)
    monkeypatch.setattr(model_client, "get_model_settings", lambda role: cfg)
    def response(payload):
        if provider == "anthropic":
            return {"id": "msg-test", "type": "message", "role": "assistant", "model": model, "content": [{"type": "text", "text": "Grounded answer [1]"}], "stop_reason": "end_turn", "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 10}}
        if provider in {"vertex_ai", "gemini"}:
            return {"candidates": [{"content": {"role": "model", "parts": [{"text": "Grounded answer [1]"}]}, "finishReason": "STOP", "index": 0}], "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 10, "totalTokenCount": 20}}
        if provider == "bedrock":
            return {"output": {"message": {"role": "assistant", "content": [{"text": "Grounded answer [1]"}]}}, "stopReason": "end_turn", "usage": {"inputTokens": 10, "outputTokens": 10, "totalTokens": 20}, "metrics": {"latencyMs": 1}}
        if provider == "ollama":
            return {"model": model, "created_at": "2026-01-01T00:00:00Z", "message": {"role": "assistant", "content": "Grounded answer [1]"}, "done": True, "done_reason": "stop", "prompt_eval_count": 10, "eval_count": 10}
        return {"id": "chat-test", "object": "chat.completion", "created": 1, "model": model, "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "Grounded answer [1]"}}], "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}}
    requests = provider_transport(response)
    assert model_client.generate_text("Answer using the document [1]", "answer") == "Grounded answer [1]"
    assert len(requests) == 1
    assert "Answer using the document" in json.dumps(requests[0])

@pytest.mark.parametrize("provider", ["openai", "openai_compatible", "nvidia_nim"])
def test_embedding_protocols_and_query_document_modes(provider_transport, provider):
    cfg = ModelSettings(provider=provider, model="nvidia/nv-embed-v1" if provider == "nvidia_nim" else "embed-test",
                        api_key="test-only", base_url="https://provider.test/v1", max_retries=0, batch_size=2,
                        document_parameters={"input_type": "passage"} if provider == "nvidia_nim" else {},
                        query_parameters={"input_type": "query"} if provider == "nvidia_nim" else {})
    def response(payload):
        return {"object": "list", "model": cfg.model, "data": [{"object": "embedding", "index": i, "embedding": [float(i + 1), 0.5, 0.2]} for i in reversed(range(len(payload["input"])))], "usage": {"prompt_tokens": 3, "total_tokens": 3}}
    requests = provider_transport(response)
    embeddings = model_client.ConfiguredEmbeddings(cfg)
    assert embeddings.embed_documents(["one", "two", "three"]) == [[1., .5, .2], [2., .5, .2], [1., .5, .2]]
    assert embeddings.embed_query("question") == [1., .5, .2]
    assert len(requests) == 3
    if provider == "nvidia_nim":
        assert [request["input_type"] for request in requests] == ["passage", "passage", "query"]

@pytest.mark.parametrize("data", [[], [{"index": 0, "embedding": []}], [{"index": 0, "embedding": [float("nan")]}], [{"index": 0, "embedding": [1, 2]}]])
def test_bad_embedding_responses_fail_closed(monkeypatch, data):
    import litellm
    monkeypatch.setattr(litellm, "embedding", lambda **kwargs: SimpleNamespace(data=data))
    embedder = model_client.ConfiguredEmbeddings(ModelSettings(provider="openai", model="test", api_key="test-only", dimensions=3))
    with pytest.raises(model_client.ModelError):
        embedder.embed_documents(["text"])


def test_provider_failure_is_sanitized_and_partial_generation_is_rejected(monkeypatch):
    import litellm
    cfg = ModelSettings(provider="openai", model="test", api_key="test-only")
    monkeypatch.setattr(model_client, "get_model_settings", lambda role: cfg)
    monkeypatch.setattr(litellm, "completion", lambda **kwargs: (_ for _ in ()).throw(RuntimeError("secret-from-provider")))
    with pytest.raises(model_client.ModelError) as error:
        model_client.generate_text("text")
    assert "secret-from-provider" not in str(error.value)
    monkeypatch.setattr(litellm, "completion", lambda **kwargs: SimpleNamespace(choices=[SimpleNamespace(finish_reason="length", message=SimpleNamespace(content="partial"))]))
    with pytest.raises(model_client.ModelError, match="incomplete"):
        model_client.generate_text("text")


def test_native_ollama_embeddings(provider_transport):
    cfg = ModelSettings(provider="ollama", model="nomic-embed-text", base_url="https://provider.test", max_retries=0)
    requests = provider_transport(lambda payload: {"model": cfg.model, "embeddings": [[.1, .2, .3] for _ in payload["input"]], "prompt_eval_count": 4})
    embeddings = model_client.ConfiguredEmbeddings(cfg)
    assert embeddings.embed_documents(["passage", "other"]) == [[.1, .2, .3], [.1, .2, .3]]
    assert embeddings.embed_query("question") == [.1, .2, .3]
    assert len(requests) == 2
