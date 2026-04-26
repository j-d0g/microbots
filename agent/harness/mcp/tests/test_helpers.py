"""Unit tests for the small pure helpers in ``server``.

These cover ``_slugify`` and ``_first_summary`` — both used by multiple
tools, so a regression here cascades. We only assert *contract*, not
incidental formatting.
"""

from __future__ import annotations

import pytest


class TestSlugify:
    def test_lowercases_and_hyphenates(self, server):
        assert server._slugify("My Workflow") == "my-workflow"

    def test_strips_leading_and_trailing_hyphens(self, server):
        assert server._slugify("  hello world  ") == "hello-world"

    def test_collapses_unsafe_chars_to_single_hyphen(self, server):
        assert server._slugify("foo!!!bar???baz") == "foo-bar-baz"

    def test_path_traversal_is_defanged(self, server):
        # Slashes, dots and parents must not survive — protects SAVED_DIR.
        slug = server._slugify("../../etc/passwd")
        assert "/" not in slug
        assert ".." not in slug
        assert slug  # still produces something non-empty

    def test_unicode_falls_through_to_hyphens(self, server):
        # Non-ascii chars are replaced; we only require the result is a
        # filesystem-safe slug (or empty if the whole input is unicode).
        slug = server._slugify("héllo wörld")
        assert all(c.isalnum() or c == "-" for c in slug)

    def test_empty_input_produces_empty_slug(self, server):
        assert server._slugify("") == ""
        assert server._slugify("!!!") == ""

    def test_deterministic(self, server):
        # Same input → same output, always.
        for name in ["foo bar", "FOO BAR", "  foo  bar  "]:
            assert server._slugify(name) == server._slugify(name)


class TestFirstSummary:
    def test_extracts_module_docstring_first_line(self, server):
        text = '"""Send a Slack ping every morning.\n\nMore detail here."""\nimport os\n'
        assert server._first_summary(text) == "Send a Slack ping every morning."

    def test_falls_back_to_first_non_import_non_comment_line(self, server):
        text = "# header\nimport os\nfrom pathlib import Path\n\nprint('hello')\n"
        assert server._first_summary(text) == "print('hello')"

    def test_returns_empty_string_when_nothing_useful(self, server):
        text = "# only comment\nimport os\nfrom x import y\n"
        assert server._first_summary(text) == ""

    def test_truncates_long_fallback_to_120_chars(self, server):
        line = "x = " + ("a" * 200)
        assert len(server._first_summary(line)) <= 120
