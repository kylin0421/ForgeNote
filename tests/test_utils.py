"""
Unit tests for the open_notebook.utils module.

This test suite focuses on testing utility functions that perform actual logic
without heavy mocking - string processing, validation, and algorithms.
"""

import pytest

from open_notebook.utils import (
    clean_thinking_content,
    parse_thinking_content,
    remove_non_ascii,
    remove_non_printable,
    token_count,
)
from open_notebook.utils.context_builder import ContextBuilder, ContextConfig

# ============================================================================
# TEST SUITE 1: Text Utilities
# ============================================================================


class TestTextUtilities:
    """Test suite for text utility functions."""

    def test_remove_non_ascii(self):
        """Test removal of non-ASCII characters."""
        # Text with various non-ASCII characters
        text_with_unicode = "Hello 世界 café naïve émoji 🎉"
        result = remove_non_ascii(text_with_unicode)

        # Should only contain ASCII characters
        assert result == "Hello  caf nave moji "
        # All characters should be in ASCII range
        assert all(ord(char) < 128 for char in result)

    def test_remove_non_ascii_pure_ascii(self):
        """Test that pure ASCII text is unchanged."""
        text = "Hello World 123 !@#"
        result = remove_non_ascii(text)
        assert result == text

    def test_remove_non_printable(self):
        """Test removal of non-printable characters."""
        # Text with various Unicode whitespace and control chars
        text = "Hello\u2000World\u200b\u202fTest"
        result = remove_non_printable(text)

        # Should have regular spaces and printable chars only
        assert "Hello" in result
        assert "World" in result
        assert "Test" in result

    def test_remove_non_printable_preserves_newlines(self):
        """Test that newlines and tabs are preserved."""
        text = "Line1\nLine2\tTabbed"
        result = remove_non_printable(text)
        assert "\n" in result
        assert "\t" in result

    def test_parse_thinking_content_basic(self):
        """Test parsing single thinking block."""
        content = "<think>This is my thinking</think>Here is my answer"
        thinking, cleaned = parse_thinking_content(content)

        assert thinking == "This is my thinking"
        assert cleaned == "Here is my answer"

    def test_parse_thinking_content_multiple_tags(self):
        """Test parsing multiple thinking blocks."""
        content = "<think>First thought</think>Answer<think>Second thought</think>More"
        thinking, cleaned = parse_thinking_content(content)

        assert "First thought" in thinking
        assert "Second thought" in thinking
        assert "<think>" not in cleaned
        assert "Answer" in cleaned
        assert "More" in cleaned

    def test_parse_thinking_content_no_tags(self):
        """Test parsing content without thinking tags."""
        content = "Just regular content"
        thinking, cleaned = parse_thinking_content(content)

        assert thinking == ""
        assert cleaned == "Just regular content"

    def test_parse_thinking_content_malformed_no_open_tag(self):
        """Test parsing malformed output where opening <think> tag is missing."""
        content = "Some thinking content</think>Here is my answer"
        thinking, cleaned = parse_thinking_content(content)

        assert thinking == "Some thinking content"
        assert cleaned == "Here is my answer"

    def test_parse_thinking_content_invalid_input(self):
        """Test parsing with invalid input types."""
        # Non-string input
        thinking, cleaned = parse_thinking_content(None)
        assert thinking == ""
        assert cleaned == ""

        # Integer input
        thinking, cleaned = parse_thinking_content(123)
        assert thinking == ""
        assert cleaned == "123"

    def test_parse_thinking_content_large_content(self):
        """Test that very large content is not processed."""
        large_content = "x" * 200000  # > 100KB limit
        thinking, cleaned = parse_thinking_content(large_content)

        # Should return unchanged due to size limit
        assert thinking == ""
        assert cleaned == large_content

    def test_clean_thinking_content(self):
        """Test convenience function for cleaning thinking content."""
        content = "<think>Internal thoughts</think>Public response"
        result = clean_thinking_content(content)

        assert "<think>" not in result
        assert "Public response" in result
        assert "Internal thoughts" not in result


# ============================================================================
# TEST SUITE 2: Token Utilities
# ============================================================================


class TestTokenUtilities:
    """Test suite for token counting fallback behavior."""

    def test_token_count_fallback(self):
        """Test fallback when tiktoken raises an error."""
        from unittest.mock import patch

        # Make tiktoken raise an ImportError to trigger fallback
        with patch(
            "tiktoken.get_encoding", side_effect=ImportError("tiktoken not available")
        ):
            text = "one two three four five"
            count = token_count(text)

            # Fallback uses word count * 1.3
            # 5 words * 1.3 = 6.5 -> 6
            assert isinstance(count, int)
            assert count > 0

    def test_token_count_falls_back_when_packaged_plugin_is_missing(self):
        """A missing tiktoken_ext plugin must not break Chinese PDFs."""
        from unittest.mock import patch

        with patch(
            "tiktoken.get_encoding",
            side_effect=ValueError("Unknown encoding o200k_base. Plugins found: []"),
        ):
            count = token_count("这是一个没有空格的中文段落，用于验证桌面安装包兜底。")

        assert count >= 20

    def test_token_count_network_error_fallback(self):
        """Test fallback when tiktoken raises a network error (issue #264).

        In offline environments tiktoken.get_encoding() tries to download the
        encoding file and raises a URLError/OSError, not an ImportError.
        The except clause must catch Exception (not only ImportError) so that
        these network failures also fall through to the word-count estimate.
        """
        import urllib.error
        from unittest.mock import patch

        with patch(
            "tiktoken.get_encoding",
            side_effect=urllib.error.URLError("No network (simulated offline)"),
        ):
            text = "one two three four five"
            count = token_count(text)

            # Must not raise; must return a positive int via the fallback
            assert isinstance(count, int)
            assert count > 0


# TEST SUITE 3: Context Builder Configuration
# ============================================================================


class TestContextBuilder:
    """Test suite for ContextBuilder initialization and configuration."""

    def test_context_config_defaults(self):
        """Test ContextConfig default values."""
        config = ContextConfig()

        assert config.sources == {}
        assert config.notes == {}
        assert config.include_insights is True
        assert config.include_notes is True
        assert config.priority_weights is not None
        assert "source" in config.priority_weights
        assert "note" in config.priority_weights
        assert "insight" in config.priority_weights

    def test_context_builder_initialization(self):
        """Test ContextBuilder initialization with various params."""
        builder = ContextBuilder(
            source_id="source:123",
            notebook_id="notebook:456",
            max_tokens=1000,
            include_insights=False,
        )

        assert builder.source_id == "source:123"
        assert builder.notebook_id == "notebook:456"
        assert builder.max_tokens == 1000
        assert builder.include_insights is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
