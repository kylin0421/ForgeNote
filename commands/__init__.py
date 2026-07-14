"""Surreal-commands integration for ZhiXue.

Importing this package stays intentionally lightweight. The API only loads the
command module needed for a submitted job, while the worker calls
``register_all`` once during startup.
"""

from importlib import import_module

from open_notebook.utils.command_cancellation import install_cancellation_guard

COMMAND_MODULES = (
    "commands.embedding_commands",
    "commands.learning_commands",
    "commands.podcast_commands",
    "commands.source_commands",
)


def register_all() -> None:
    """Import every command module so the background worker can execute jobs."""
    install_cancellation_guard()
    for module_name in COMMAND_MODULES:
        import_module(module_name)


__all__ = ["COMMAND_MODULES", "register_all"]
