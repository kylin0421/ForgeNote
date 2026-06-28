"""Surreal-commands integration for ZhiXue."""

from open_notebook.utils.command_cancellation import install_cancellation_guard

install_cancellation_guard()

from .embedding_commands import (
    embed_insight_command,
    embed_note_command,
    embed_source_command,
    rebuild_embeddings_command,
)
from .example_commands import analyze_data_command, process_text_command
from .learning_commands import (
    collect_learning_resources_command,
    generate_learning_asset_command,
)
from .podcast_commands import generate_podcast_command
from .source_commands import process_source_command

__all__ = [
    # Embedding commands
    "embed_note_command",
    "embed_insight_command",
    "embed_source_command",
    "rebuild_embeddings_command",
    "collect_learning_resources_command",
    "generate_learning_asset_command",
    # Other commands
    "generate_podcast_command",
    "process_source_command",
    "process_text_command",
    "analyze_data_command",
]
