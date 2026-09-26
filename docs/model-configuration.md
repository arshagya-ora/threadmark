# Model configuration

Threadmark loads named profiles from `backend/models.yaml`. No Python edits are
needed to change a supported model or endpoint. Model inference may be hosted or
local, independently of where the Threadmark app runs.

## Choose the three roles

```yaml
active_profile: anthropic
active_embedding_profile: openai
graph_profile: null
```

- `active_profile` selects the answer model from `profiles`.
- `graph_profile` selects graph extraction from the same `profiles` mapping.
  Leave it `null` to reuse the answer model.
- `active_embedding_profile` selects a text embedding model from `embedding_profiles`.
  A chat-only model cannot fill this role. For example, use Claude for chat and
  an OpenAI, NVIDIA, Ollama, or another supported embedding model for retrieval.

Only the selected roles resolve `${ENVIRONMENT_VARIABLE}` references. Unused
profiles do not require credentials. Copy `backend/.env.example` to `backend/.env`
and set only the variables you need. Real secrets should stay out of YAML and Git.

Restart the backend after editing YAML or `.env`. Settings stay fixed during a
running process, keeping uploads and queries in the same vector space. You can
set `THREADMARK_MODEL_CONFIG` to another YAML path; the default path is resolved
relative to the backend code, not the working directory. Relative Google
`credentials_file` paths are resolved relative to the YAML file.

## Hosted model through a compatible endpoint

The endpoint must implement the OpenAI chat-completions and/or text-embeddings
protocol for the role you select. The two roles can use different servers.

```yaml
active_profile: hosted
active_embedding_profile: hosted
graph_profile: null

profiles:
  hosted:
    provider: openai_compatible
    model: ${HOSTED_MODEL}
    base_url: ${HOSTED_BASE_URL}
    api_key: ${HOSTED_API_KEY}
    max_tokens: 2048
    request_timeout: 60
    max_retries: 1

embedding_profiles:
  hosted:
    provider: openai_compatible
    model: ${HOSTED_EMBEDDING_MODEL}
    base_url: ${HOSTED_EMBEDDING_BASE_URL}
    api_key: ${HOSTED_EMBEDDING_API_KEY}
    batch_size: 32
```

Use the server's base URL including `/v1` where required. Enter the model ID that
server exposes. For an endpoint intentionally running without authentication,
omit `api_key`; Threadmark supplies a non-secret placeholder so the SDK will not
reuse a different provider's environment credential. vLLM and LM Studio can be
used through compatible endpoints when configured to serve the required role.

## Local Ollama

Select the bundled `ollama` profiles for both roles:

```yaml
active_profile: ollama
active_embedding_profile: ollama
```

Set `OLLAMA_MODEL` and `OLLAMA_EMBEDDING_MODEL` in `.env` to models already pulled
on your Ollama server. The example profiles connect to `http://localhost:11434`.
Change `base_url` for another server. Threadmark does not install/download model
weights or start Ollama. In a container, localhost refers to that container.

## Provider choices

| YAML provider | Connection |
| --- | --- |
| `nvidia_nim` | NVIDIA model ID and API key; optional self-hosted base URL |
| `openai` | OpenAI model ID and API key |
| `openai_compatible` | Explicit endpoint URL and the model ID it exposes |
| `anthropic` | Anthropic model ID and API key; chat/graph only |
| `gemini` | Google AI Studio model ID and API key |
| `vertex_ai` | Model ID, project ID, location, and Google application default credentials or credential file |
| `bedrock` | Model/inference-profile ID, AWS region, and the AWS credential chain or configured credentials |
| `ollama` | Local/remote Ollama base URL and installed model name |
| `cohere` | Cohere model ID and API key; add a named profile with role-appropriate parameters |

Provider protocols are translated by the pinned LiteLLM SDK. Model availability,
access, regional support, accepted parameters, and embedding support depend on the
provider. This is not a promise that every chat model can embed text or reliably
produce graph JSON. See [LiteLLM providers](https://docs.litellm.ai/docs/providers)
and [embedding support](https://docs.litellm.ai/docs/embedding/supported_embedding).

GCP `gcp` profiles use `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, and the
role-specific model variables from `.env.example`. Use application default
credentials locally or an attached service account when deployed. An optional
`credentials_file` may point to service-account JSON.

AWS `aws` profiles use `AWS_REGION` and the role-specific model variables. The
SDK uses the normal AWS credential chain by default. Alternatively, set
`aws_profile`, or supply `aws_access_key_id` + `aws_secret_access_key` (and optional
`aws_session_token`) through environment references. A Bedrock bearer token may
be supplied as `api_key`. Choose one authentication method.

## Generation and embedding parameters

`defaults` apply to chat/graph profiles; individual profile fields override them.
`graph_defaults` then override the graph role only. `embedding_defaults` apply to
embedding profiles. The bundled configuration keeps NVIDIA as the default,
with a 1,024-token answer budget and an 8,192-token graph budget.

Set `temperature` and `top_p` only for models that support them. They are omitted
unless configured. Other provider-specific generation options can be supplied
under `parameters`, for example `reasoning_effort` where supported. Unsupported
parameters produce an error rather than being silently discarded. Connection
fields and application-owned request fields cannot be overridden there.

Embedding profiles support `dimensions` where supported, `batch_size`, shared
`parameters`, and separate `document_parameters` / `query_parameters`. The NVIDIA
profile supplies `input_type: passage` for indexing and `input_type: query` for
questions, matching [NVIDIA NIM's embedding modes](https://docs.litellm.ai/docs/providers/nvidia_nim).
Other embedding providers may require their own task type or input parameters.

The configured embedding model is also used for the existing relevance metric.
An unavailable metric is recorded as unknown, not an invented score. This metric
is a similarity measurement, not a correctness guarantee.

## Switching embeddings and existing documents

Chat model changes do not require re-indexing documents. Changing the embedding
model, dimensions, endpoint/deployment, or embedding input parameters selects a
separate Chroma collection. Different vector spaces are never mixed merely
because their dimensions match.

On the next question, document retry, or repeat upload, Threadmark checks that
document's saved embedding fingerprint. If it changed, saved passages are embedded
into the selected collection before retrieval. The first request may take longer
and may incur embedding-provider usage. Metadata and original PDFs are retained.
The success marker changes only after indexing finishes; failed indexing can be
retried. Legacy documents without a fingerprint are re-indexed once.

Old collections are retained. Switching back is safe, though a document may be
embedded again. Rotating an API key, changing batching, or changing chat parameters
does not change the embedding fingerprint. Existing graphs remain available; a
new graph profile is used on the next extraction/retry rather than rewriting all
saved graphs automatically.

## Troubleshooting

- Missing variable or invalid profile: correct the named field in YAML/`.env` and restart.
- Unknown model/unsupported parameter: verify the exact model ID and options with your provider.
- Graph extraction failure: use an instruction-following model that can return JSON;
  check its output-token limit. Indexed documents remain usable for chat.
- No hosted credentials: use a configured local endpoint or the bundled sample.
  Library access and sample mode do not require model configuration to be valid.

Offline checks, from `backend/`: `python -m pytest tests -q`. The suite mocks
provider HTTP/auth and includes a real temporary Chroma persistence check.
