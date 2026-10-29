from config import Config, LLMConfig
from ingest.pullers.fixture import FixturePuller
import pytest


def test_openrouter_is_selected_when_only_its_key_exists(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-placeholder")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert LLMConfig().provider == "openrouter"


def test_offline_is_explicit_not_a_missing_key_fallback(monkeypatch):
    monkeypatch.delenv("KG_LLM_MODE", raising=False)
    assert Config().offline is False
    monkeypatch.setenv("KG_LLM_MODE", "offline")
    assert Config().offline is True


async def test_missing_fixtures_fail_instead_of_silent_success(tmp_path):
    with pytest.raises(FileNotFoundError, match="Fixture not found"):
        await FixturePuller("slack", tmp_path).pull(Config(offline=True), None)
