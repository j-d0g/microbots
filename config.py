"""Configuration for the Composio → triage → SurrealDB pipeline."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal

from dotenv import load_dotenv

load_dotenv()


@dataclass
class LLMConfig:
    provider: Literal["openrouter", "anthropic"] = "openrouter"
    openrouter_model: str = "nvidia/nemotron-ultra-253b"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    anthropic_model: str = "claude-haiku-4-5-20251001"
    max_tokens: int = 4096
    temperature: float = 0.2


@dataclass
class BackfillConfig:
    backfill_weeks: int = 1
    pull_all_project_data: bool = True


@dataclass
class IntegrationScopes:
    slack_enabled: bool = True
    github_enabled: bool = True
    github_repos: list[str] = field(default_factory=list)
    linear_enabled: bool = True
    linear_projects: list[str] = field(default_factory=list)
    gmail_enabled: bool = True
    gmail_labels: list[str] = field(
        default_factory=lambda: ["INBOX", "SENT"]
    )
    notion_enabled: bool = True
    notion_databases: list[str] = field(default_factory=list)
    perplexity_enabled: bool = True


@dataclass
class PipelineConfig:
    poll_interval_minutes: int = 30
    max_retries: int = 3
    batch_size: int = 20
    parallel_llm_calls: int = 5
    composio_toolkit_version: str = "latest"


@dataclass
class Config:
    llm: LLMConfig = field(default_factory=LLMConfig)
    backfill: BackfillConfig = field(default_factory=BackfillConfig)
    scopes: IntegrationScopes = field(default_factory=IntegrationScopes)
    pipeline: PipelineConfig = field(default_factory=PipelineConfig)
    surreal_url: str = field(
        default_factory=lambda: os.getenv("SURREAL_URL", "ws://localhost:8000/rpc")
    )
    surreal_user: str = field(
        default_factory=lambda: os.getenv("SURREAL_USER", "root")
    )
    surreal_password: str = field(
        default_factory=lambda: os.getenv("SURREAL_PASS", "root")
    )
    surreal_ns: str = field(
        default_factory=lambda: os.getenv("SURREAL_NS", "microbots")
    )
    surreal_db: str = field(
        default_factory=lambda: os.getenv("SURREAL_DB", "memory")
    )
    composio_user_id: str = field(
        default_factory=lambda: os.getenv("COMPOSIO_USER_ID", "default")
    )
    openrouter_api_key: str | None = field(
        default_factory=lambda: os.getenv("OPENROUTER_API_KEY")
    )
    anthropic_api_key: str | None = field(
        default_factory=lambda: os.getenv("ANTHROPIC_API_KEY")
    )
    composio_api_key: str | None = field(
        default_factory=lambda: os.getenv("COMPOSIO_API_KEY")
    )


def load_config() -> Config:
    return Config(
        llm=LLMConfig(),
        backfill=BackfillConfig(),
        scopes=IntegrationScopes(),
        pipeline=PipelineConfig(),
    )
