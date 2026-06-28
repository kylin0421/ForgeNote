"""Cooperative cancellation support for surreal-commands jobs."""

from __future__ import annotations

from functools import wraps
from typing import Any, Callable

from loguru import logger

from open_notebook.database.repository import ensure_record_id, repo_query


class CommandCancelledError(ValueError):
    """Raised when a command observes that its job has been canceled."""


async def get_command_status_value(command_id: str) -> str | None:
    rows = await repo_query(
        "SELECT status FROM $command_id LIMIT 1",
        {"command_id": ensure_record_id(command_id)},
    )
    if not rows:
        return None
    status = rows[0].get("status")
    return str(status) if status is not None else None


async def is_command_canceled(command_id: str | None) -> bool:
    if not command_id or command_id == "unknown":
        return False
    return await get_command_status_value(command_id) == "canceled"


async def raise_if_command_canceled(command_id: str | None) -> None:
    if await is_command_canceled(command_id):
        raise CommandCancelledError("Command was canceled by the user")


def install_cancellation_guard() -> None:
    """Patch surreal-commands so canceled jobs do not keep running or get overwritten.

    The upstream worker has no public cancellation API. Queue cancellation works by
    moving `new` jobs to `canceled`; running jobs are cooperative and can only stop
    at await boundaries or before final status persistence.
    """
    try:
        from surreal_commands.core.service import CommandService
    except Exception as exc:
        logger.warning(f"Failed to install command cancellation guard: {exc}")
        return

    if getattr(CommandService, "_open_notebook_cancel_guard_installed", False):
        return

    original_execute_command: Callable[..., Any] = CommandService.execute_command
    original_update_command_result: Callable[..., Any] = (
        CommandService.update_command_result
    )

    @wraps(original_execute_command)
    async def guarded_execute_command(
        self: CommandService,
        command_id: str,
        command_name: str,
        input_data: dict[str, Any],
        user_context: dict[str, Any] | None = None,
    ) -> Any:
        if await is_command_canceled(str(command_id)):
            logger.info(f"Skipping canceled command before execution: {command_id}")
            return None
        return await original_execute_command(
            self,
            command_id,
            command_name,
            input_data,
            user_context,
        )

    @wraps(original_update_command_result)
    async def guarded_update_command_result(
        self: CommandService,
        command_id: str,
        status: str,
        result: list[Any] | dict[str, Any] | None = None,
        error_message: str | None = "",
    ) -> None:
        current_status = await get_command_status_value(str(command_id))
        if current_status == "canceled" and status != "canceled":
            logger.info(
                f"Keeping canceled status for {command_id}; skipped update to {status}"
            )
            return
        await original_update_command_result(
            self,
            command_id,
            status,
            {} if result is None else result,
            error_message,
        )

    CommandService.execute_command = guarded_execute_command
    CommandService.update_command_result = guarded_update_command_result
    CommandService._open_notebook_cancel_guard_installed = True
    logger.info("Installed ZhiXue command cancellation guard")
