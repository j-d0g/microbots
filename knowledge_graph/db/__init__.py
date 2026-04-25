"""MicrobotsDB — kaig-inspired typed SurrealDB wrapper."""
from db.client import MicrobotsDB
from db.queries import NAMED_QUERIES

__all__ = ["MicrobotsDB", "NAMED_QUERIES"]
