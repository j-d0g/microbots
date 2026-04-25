"""Data classes returned and persisted by the SDK."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class DeployResult:
    """Returned by :meth:`RenderSDK.deploy` on success."""

    url: str                # Live onrender.com URL
    service_id: str         # Render service ID  (srv-…)
    deploy_id: str          # Render deploy ID   (dep-…)
    service_name: str       # Human-readable slug used on Render
    image_tag: str          # Full image URL pushed to registry
    duration_s: float       # Seconds from deploy() call to live status
    is_new: bool            # True if a new Render service was created
    region: str             # Render region code (fra, ore, etc.)


@dataclass
class RegistryEntry:
    """One entry in the JSON service registry."""

    service_id: str
    service_name: str
    deploy_hook: str        # Full deploy hook URL (includes key param)
    image_repo: str         # e.g. "myorg/lead-scraper-a1b2"
    region: str
    live_url: str
    created_at: str         # ISO-8601
    last_deployed: str      # ISO-8601
    deploy_count: int
    status: str             # live | build_failed | deploying | unknown

    def to_dict(self) -> dict:
        return {
            "service_id":    self.service_id,
            "service_name":  self.service_name,
            "deploy_hook":   self.deploy_hook,
            "image_repo":    self.image_repo,
            "region":        self.region,
            "live_url":      self.live_url,
            "created_at":    self.created_at,
            "last_deployed": self.last_deployed,
            "deploy_count":  self.deploy_count,
            "status":        self.status,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "RegistryEntry":
        return cls(**d)
