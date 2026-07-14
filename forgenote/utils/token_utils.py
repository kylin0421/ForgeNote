"""
Token utilities for ForgeNote.
Handles token counting and cost calculations for language models.
"""

import os
import re

from forgenote.config import TIKTOKEN_CACHE_DIR

# Set tiktoken cache directory before importing tiktoken to ensure
# tokenizer encodings are cached persistently in the data folder
os.environ["TIKTOKEN_CACHE_DIR"] = TIKTOKEN_CACHE_DIR

_tokenizer_warning_logged = False


def _estimated_token_count(input_string: str) -> int:
    """Estimate tokens without making token counting a runtime dependency."""
    if not input_string:
        return 0

    cjk_chars = len(re.findall(r"[\u3400-\u9fff\uf900-\ufaff]", input_string))
    non_cjk = re.sub(r"[\u3400-\u9fff\uf900-\ufaff]", "", input_string)
    # Four Latin characters per token is a conservative general-purpose
    # estimate. Count CJK characters individually so Chinese text is not
    # under-counted merely because it contains no spaces.
    non_cjk_tokens = (len(non_cjk) + 3) // 4
    return max(1, cjk_chars + non_cjk_tokens)


def token_count(input_string: str) -> int:
    """
    Count the number of tokens in the input string using the 'o200k_base' encoding.

    Args:
        input_string (str): The input string to count tokens for.

    Returns:
        int: The number of tokens in the input string.
    """
    try:
        import tiktoken

        encoding = tiktoken.get_encoding("o200k_base")
        # disallowed_special=() treats sequences like "<|endoftext|>" as ordinary
        # text instead of raising ValueError. User/source content can legitimately
        # contain these substrings, and we only need a token count here.
        tokens = encoding.encode(input_string, disallowed_special=())
        return len(tokens)
    except Exception as e:
        # Token counting is used for routing and chunk sizing, so an optional
        # tokenizer plugin/cache problem must never make PDF processing or chat
        # unusable. This also covers PyInstaller builds where tiktoken's dynamic
        # ``tiktoken_ext`` plugin was not discovered.
        from loguru import logger

        global _tokenizer_warning_logged
        if not _tokenizer_warning_logged:
            logger.warning(
                "tiktoken unavailable, falling back to token estimation: {}", e
            )
            _tokenizer_warning_logged = True
        return _estimated_token_count(input_string)


def token_cost(token_count: int, cost_per_million: float = 0.150) -> float:
    """
    Calculate the cost of tokens based on the token count and cost per million tokens.

    Args:
        token_count (int): The number of tokens.
        cost_per_million (float): The cost per million tokens. Default is 0.150.

    Returns:
        float: The calculated cost for the given token count.
    """
    return cost_per_million * (token_count / 1_000_000)
