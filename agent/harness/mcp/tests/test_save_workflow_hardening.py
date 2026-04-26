"""Contract tests for the hardening additions to ``save_workflow``.

Driven by adversarial findings (notes/02-adversarial-findings.md):

* H3 — silent overwrite. Default ``overwrite=False`` returns
  ``{error: "exists", ...}`` rather than clobbering. Must opt-in.
* M1 — 1000-char names crashed with OSError. ``_slugify`` now caps at
  ``MAX_SLUG_LEN`` (64) to stay well under filesystem NAME_MAX.
* M2 — no code-size cap. ``save_workflow`` now refuses payloads larger
  than ``MAX_CODE_BYTES`` (~1 MB).
"""

from __future__ import annotations


class TestNoSilentOverwrite:
    def test_first_save_succeeds(self, server):
        out = server.save_workflow("alpha", "v1\n")
        assert "saved_to" in out
        assert "error" not in out

    def test_second_save_without_overwrite_refuses(self, server):
        server.save_workflow("alpha", "v1\n")
        out = server.save_workflow("alpha", "v2\n")
        assert out.get("error") == "exists"
        assert out["slug"] == "alpha"
        assert "existing_bytes" in out
        assert "hint" in out

    def test_overwrite_true_replaces(self, server):
        server.save_workflow("alpha", "v1\n")
        out = server.save_workflow("alpha", "v2\n", overwrite=True)
        assert "saved_to" in out
        assert "error" not in out
        assert server.view_workflow("alpha")["code"] == "v2\n"

    def test_slug_collision_also_refuses(self, server):
        # "data sync" and "data-sync" both slugify to "data-sync".
        # Without the gate, the second silently overwrote the first.
        server.save_workflow("data sync", "first\n")
        out = server.save_workflow("data-sync", "second\n")
        assert out.get("error") == "exists"
        # Original content preserved.
        assert server.view_workflow("data sync")["code"] == "first\n"


class TestSlugLengthCap:
    def test_long_name_truncates_cleanly(self, server, tmp_path):
        long_name = "a" * 1000
        out = server.save_workflow(long_name, "print('ok')\n")
        # Must NOT crash, must produce a short slug.
        assert "saved_to" in out, f"unexpected error: {out}"
        # Slug derived from the name should be capped.
        from server import MAX_SLUG_LEN

        # Round-trip verifies the slug landed on disk safely.
        viewed = server.view_workflow(long_name)
        assert "code" in viewed
        assert len(viewed["slug"]) <= MAX_SLUG_LEN

    def test_unicode_and_punctuation_collapse(self, server):
        out = server.save_workflow("café — 北京 :: alpha!!!", "x = 1\n")
        assert "saved_to" in out
        # Whatever the slug is, it should be safe ASCII.
        assert all(c.isascii() for c in out["saved_to"])


class TestCodeSizeCap:
    def test_under_cap_succeeds(self, server):
        code = "x = 1\n" * 1000  # ~7 KB
        out = server.save_workflow("smol", code)
        assert "saved_to" in out

    def test_over_cap_refuses(self, server):
        from server import MAX_CODE_BYTES

        big = "x" * (MAX_CODE_BYTES + 1)
        out = server.save_workflow("huge", big)
        assert out.get("error") == "code too large"
        assert out["bytes"] > out["max_bytes"]
