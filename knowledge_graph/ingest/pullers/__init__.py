from __future__ import annotations

from config import Config
from ingest.pullers.github import GitHubPuller
from ingest.pullers.gmail import GmailPuller
from ingest.pullers.linear import LinearPuller
from ingest.pullers.notion import NotionPuller
from ingest.pullers.perplexity import PerplexityPuller
from ingest.pullers.slack import SlackPuller
from ingest.pullers.base import BasePuller, RawItem

_PULLERS: dict[str, type[BasePuller]] = {
    "slack": SlackPuller,
    "github": GitHubPuller,
    "linear": LinearPuller,
    "gmail": GmailPuller,
    "notion": NotionPuller,
    "perplexity": PerplexityPuller,
}


def get_puller(name: str) -> BasePuller:
    cls = _PULLERS.get(name)
    if cls is None:
        raise ValueError(f"Unknown integration: {name}")
    return cls()


def enabled_integrations(config: Config) -> list[str]:
    e: list[str] = []
    if config.scopes.slack_enabled:
        e.append("slack")
    if config.scopes.github_enabled:
        e.append("github")
    if config.scopes.linear_enabled:
        e.append("linear")
    if config.scopes.gmail_enabled:
        e.append("gmail")
    if config.scopes.notion_enabled:
        e.append("notion")
    if config.scopes.perplexity_enabled:
        e.append("perplexity")
    return e
