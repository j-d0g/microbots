"""Base puller types."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from composio import Composio

from config import Config


@dataclass
class RawItem:
    external_id: str
    source_type: str
    integration: str
    content: dict[str, Any]
    occurred_at: datetime
    metadata: dict[str, Any] = field(default_factory=dict)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class BasePuller(ABC):
    name: str

    @abstractmethod
    async def pull(self, config: Config, composio: Composio) -> list[RawItem]:
        raise NotImplementedError
