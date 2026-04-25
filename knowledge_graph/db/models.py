"""Pydantic models for every node and edge type in the SurrealDB memory graph."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


# ---------------------------------------------------------------------------
# Node models
# ---------------------------------------------------------------------------

class UserProfile(_Base):
    id: str | None = None
    name: str
    role: str | None = None
    goals: list[str] = Field(default_factory=list)
    preferences: dict[str, Any] = Field(default_factory=dict)
    context_window: int = 4000
    created_at: datetime | None = None
    updated_at: datetime | None = None


class Integration(_Base):
    id: str | None = None
    name: str
    slug: str
    category: str | None = None
    description: str | None = None
    user_purpose: str | None = None
    usage_patterns: list[str] = Field(default_factory=list)
    navigation_tips: list[str] = Field(default_factory=list)
    frequency: str | None = None
    composio_tool: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class Entity(_Base):
    id: str | None = None
    name: str
    entity_type: str
    description: str | None = None
    aliases: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    embedding: list[float] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class Chat(_Base):
    id: str | None = None
    title: str | None = None
    content: str
    source_type: str
    source_id: str | None = None
    signal_level: str | None = None
    summary: str | None = None
    embedding: list[float] | None = None
    occurred_at: datetime | None = None
    created_at: datetime | None = None


class Memory(_Base):
    id: str | None = None
    content: str
    memory_type: str
    confidence: float = 0.5
    source: str | None = None
    tags: list[str] = Field(default_factory=list)
    embedding: list[float] | None = None
    last_validated: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class Skill(_Base):
    id: str | None = None
    name: str
    slug: str
    description: str
    steps: list[str] = Field(default_factory=list)
    frequency: str | None = None
    tags: list[str] = Field(default_factory=list)
    strength: int = 1
    embedding: list[float] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class Workflow(_Base):
    id: str | None = None
    name: str
    slug: str
    description: str
    trigger: str | None = None
    outcome: str | None = None
    frequency: str | None = None
    tags: list[str] = Field(default_factory=list)
    embedding: list[float] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


# ---------------------------------------------------------------------------
# Edge / join-query models (lightweight projections)
# ---------------------------------------------------------------------------

class CoUsedWith(_Base):
    """co_used_with edge between two integrations."""
    in_slug: str | None = Field(None, alias="in")
    out_slug: str | None = Field(None, alias="out")
    frequency: int | None = None
    common_context: str | None = None


class SkillWithIntegrations(Skill):
    """Skill row joined with its integration slugs."""
    integrations: list[str] = Field(default_factory=list)


class WorkflowWithSkills(Workflow):
    """Workflow row joined with ordered skill slugs (or {skill_slug, step_order} dicts)."""
    skill_chain: list[str | dict] = Field(default_factory=list)

    @property
    def skill_slugs(self) -> list[str]:
        """Extract ordered skill slug strings regardless of whether items are str or dict."""
        result = []
        for item in self.skill_chain:
            if isinstance(item, str):
                result.append(item)
            elif isinstance(item, dict):
                slug = item.get("skill_slug") or item.get("out", {})
                if isinstance(slug, str):
                    result.append(slug)
        return result


# ---------------------------------------------------------------------------
# Named-query result models
# ---------------------------------------------------------------------------

class IntegrationsOverviewRow(_Base):
    slug: str
    name: str
    category: str | None = None
    frequency: str | None = None
    description: str | None = None
    user_purpose: str | None = None
    co_used_with_slugs: list[str] = Field(default_factory=list)


class IntegrationDetailResult(_Base):
    integration: Integration
    entities: list[Entity] = Field(default_factory=list)
    top_memories: list[Memory] = Field(default_factory=list)
    skills: list[Skill] = Field(default_factory=list)


class EntityTypeRow(_Base):
    entity_type: str
    count: int


class ChatsSummaryRow(_Base):
    integration: str | None = None
    signal_level: str | None = None
    count: int = 0


class UserProfileResult(_Base):
    profile: UserProfile
    chat_count: int = 0
    memory_count: int = 0
    skill_count: int = 0
    workflow_count: int = 0
    entity_count: int = 0
    integration_count: int = 0
