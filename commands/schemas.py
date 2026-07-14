"""Lightweight command payloads shared by the API and worker."""

from typing import Any, Dict, List

from surreal_commands import CommandInput


class SourceProcessingInput(CommandInput):
    source_id: str
    content_state: Dict[str, Any]
    notebook_ids: List[str]
    transformations: List[str]
    embed: bool
