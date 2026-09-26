import pytest
from app import model_config

@pytest.fixture(autouse=True)
def isolated_model_configuration(monkeypatch):
    monkeypatch.setattr(model_config, "load_dotenv", lambda *args, **kwargs: None)
    monkeypatch.setenv("THREADMARK_MODEL_CONFIG", str(model_config.BACKEND / "models.yaml"))
    model_config.clear_model_config_cache()
    yield
    model_config.clear_model_config_cache()
