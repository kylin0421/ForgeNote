from importlib import import_module
from typing import Any, Dict, List, Optional

from loguru import logger
from surreal_commands import get_command_status, submit_command

from open_notebook.database.repository import ensure_record_id, repo_query

DISMISSIBLE_STATUSES = {"failed", "canceled"}
COMMAND_MODULE_BY_NAME = {
    "collect_learning_resources": "commands.learning_commands",
    "create_insight": "commands.embedding_commands",
    "embed_chunk": "commands.embedding_commands",
    "embed_insight": "commands.embedding_commands",
    "embed_note": "commands.embedding_commands",
    "embed_single_item": "commands.embedding_commands",
    "embed_source": "commands.embedding_commands",
    "generate_learning_asset": "commands.learning_commands",
    "generate_podcast": "commands.podcast_commands",
    "process_source": "commands.source_commands",
    "rebuild_embeddings": "commands.embedding_commands",
    "run_transformation": "commands.source_commands",
    "vectorize_source": "commands.embedding_commands",
}
MAX_LOG_STRING_LENGTH = 1200
MAX_LOG_COLLECTION_ITEMS = 12
MAX_LOG_DEPTH = 4


def _compact_for_log(value: Any, depth: int = 0) -> Any:
    """Keep diagnostic payloads readable for queue UI logs."""
    if depth >= MAX_LOG_DEPTH:
        return "<nested payload truncated>"

    if isinstance(value, str):
        if len(value) <= MAX_LOG_STRING_LENGTH:
            return value
        omitted = len(value) - MAX_LOG_STRING_LENGTH
        return f"{value[:MAX_LOG_STRING_LENGTH]}\n... <truncated {omitted} chars>"

    if isinstance(value, list):
        compact_items = [
            _compact_for_log(item, depth + 1)
            for item in value[:MAX_LOG_COLLECTION_ITEMS]
        ]
        if len(value) > MAX_LOG_COLLECTION_ITEMS:
            compact_items.append(
                f"<truncated {len(value) - MAX_LOG_COLLECTION_ITEMS} items>"
            )
        return compact_items

    if isinstance(value, dict):
        compact_dict: Dict[str, Any] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= MAX_LOG_COLLECTION_ITEMS:
                compact_dict["_truncated_items"] = (
                    len(value) - MAX_LOG_COLLECTION_ITEMS
                )
                break
            compact_dict[key] = _compact_for_log(item, depth + 1)
        return compact_dict

    return value


class CommandService:
    """Generic service layer for command operations"""

    @staticmethod
    async def submit_command_job(
        module_name: str,  # Actually app_name for surreal-commands
        command_name: str,
        command_args: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Submit a generic command job for background processing"""
        try:
            # submit_command validates against the local registry. Import only
            # the module that owns this job instead of loading every AI provider
            # and podcast dependency during API startup.
            module_name_to_import = COMMAND_MODULE_BY_NAME.get(command_name)
            if module_name_to_import is None:
                raise ValueError(f"Unknown command: {command_name}")
            try:
                import_module(module_name_to_import)
            except ImportError as import_err:
                logger.error(f"Failed to import {module_name_to_import}: {import_err}")
                raise ValueError("Command module not available") from import_err

            # surreal-commands expects: submit_command(app_name, command_name, args)
            cmd_id = submit_command(
                module_name,  # This is actually the app name (e.g., "open_notebook")
                command_name,
                command_args,  # Input data
            )
            # Convert RecordID to string if needed
            if not cmd_id:
                raise ValueError("Failed to get cmd_id from submit_command")
            cmd_id_str = str(cmd_id)
            logger.info(
                f"Submitted command job: {cmd_id_str} for {module_name}.{command_name}"
            )
            return cmd_id_str

        except Exception as e:
            logger.error(f"Failed to submit command job: {e}")
            raise

    @staticmethod
    async def get_command_status(job_id: str) -> Dict[str, Any]:
        """Get status of any command job"""
        try:
            status = await get_command_status(job_id)
            return {
                "job_id": job_id,
                "status": status.status if status else "unknown",
                "result": status.result if status else None,
                "error_message": getattr(status, "error_message", None)
                if status
                else None,
                "created": str(status.created)
                if status and hasattr(status, "created") and status.created
                else None,
                "updated": str(status.updated)
                if status and hasattr(status, "updated") and status.updated
                else None,
                "progress": getattr(status, "progress", None) if status else None,
            }
        except Exception as e:
            logger.error(f"Failed to get command status: {e}")
            raise

    @staticmethod
    async def list_command_jobs(
        module_filter: Optional[str] = None,
        command_filter: Optional[str] = None,
        status_filter: Optional[str] = None,
        limit: int = 50,
        include_dismissed: bool = False,
    ) -> List[Dict[str, Any]]:
        """List command jobs with optional filtering"""
        limit = max(1, min(limit, 100))
        filters = []
        params: Dict[str, Any] = {"limit": limit}
        if not include_dismissed:
            filters.append("dismissed_at IS NONE")
        if module_filter:
            filters.append("app = $module_filter")
            params["module_filter"] = module_filter
        if command_filter:
            filters.append("name = $command_filter")
            params["command_filter"] = command_filter
        if status_filter:
            filters.append("status = $status_filter")
            params["status_filter"] = status_filter

        where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
        rows = await repo_query(
            f"""
            SELECT
                id,
                app,
                name,
                status,
                error_message,
                created,
                updated,
                args.source_id AS source_id,
                args.note_id AS note_id,
                args.insight_id AS insight_id,
                args.item_id AS item_id,
                args.item_type AS item_type,
                args.episode_name AS episode_name,
                args.mode AS rebuild_mode,
                args.goal AS goal,
                args.message AS message,
                args.output_kind AS output_kind,
                args.learning_record_id AS learning_record_id,
                args.include_sources AS include_sources,
                args.include_notes AS include_notes,
                args.include_insights AS include_insights,
                result.success AS result_success,
                result.processing_time AS processing_time,
                result.chunks_created AS chunks_created,
                result.insights_created AS insights_created,
                result.jobs_submitted AS jobs_submitted,
                result.total_items AS total_items,
                result.sources_submitted AS sources_submitted,
                result.notes_submitted AS notes_submitted,
                result.insights_submitted AS insights_submitted,
                result.episode_id AS episode_id,
                result.resources_found AS resources_found,
                result.note_id AS result_note_id,
                result.output_kind AS result_output_kind,
                result.title AS result_title,
                result.error_message AS result_error_message
            FROM command
            {where_clause}
            ORDER BY updated DESC, created DESC, id DESC
            LIMIT $limit
            """,
            params,
        )

        jobs: List[Dict[str, Any]] = []
        for row in rows:
            error_message = row.get("error_message") or row.get("result_error_message")
            result_summary = {
                key: row.get(key)
                for key in [
                    "result_success",
                    "processing_time",
                    "chunks_created",
                    "insights_created",
                    "jobs_submitted",
                    "total_items",
                    "sources_submitted",
                    "notes_submitted",
                    "insights_submitted",
                    "episode_id",
                    "resources_found",
                    "result_note_id",
                    "result_output_kind",
                    "result_title",
                ]
                if row.get(key) is not None
            }
            target = {
                key: row.get(key)
                for key in [
                    "source_id",
                    "note_id",
                    "insight_id",
                    "item_id",
                    "item_type",
                    "episode_name",
                    "rebuild_mode",
                    "goal",
                    "message",
                    "output_kind",
                    "learning_record_id",
                    "include_sources",
                    "include_notes",
                    "include_insights",
                ]
                if row.get(key) is not None
            }
            jobs.append(
                {
                    "job_id": row.get("id"),
                    "app": row.get("app"),
                    "command": row.get("name"),
                    "status": row.get("status") or "unknown",
                    "target": target,
                    "result_summary": result_summary,
                    "error_message": error_message,
                    "created": str(row["created"]) if row.get("created") else None,
                    "updated": str(row["updated"]) if row.get("updated") else None,
                }
            )
        return jobs

    @staticmethod
    async def get_command_log(job_id: str) -> Dict[str, Any]:
        """Return persisted command details for failure inspection."""
        try:
            record_id = ensure_record_id(job_id)
            rows = await repo_query(
                """
                SELECT
                    id,
                    app,
                    name,
                    status,
                    args,
                    result,
                    error_message,
                    created,
                    updated
                FROM $job_id
                LIMIT 1
                """,
                {"job_id": record_id},
            )
            if not rows:
                raise ValueError(f"Command job not found: {job_id}")

            row = rows[0]
            result = row.get("result")
            args = row.get("args")
            error_message = row.get("error_message")
            log_lines = [
                f"Job: {row.get('id') or job_id}",
                f"Command: {row.get('app') or 'unknown'}.{row.get('name') or 'unknown'}",
                f"Status: {row.get('status') or 'unknown'}",
            ]
            if row.get("created"):
                log_lines.append(f"Created: {row.get('created')}")
            if row.get("updated"):
                log_lines.append(f"Updated: {row.get('updated')}")
            if error_message:
                log_lines.extend(["", "Error:", str(error_message)])

            if isinstance(result, dict):
                result_error = result.get("error_message") or result.get("error")
                if result_error and result_error != error_message:
                    log_lines.extend(["", "Result error:", str(result_error)])

            return {
                "job_id": row.get("id") or job_id,
                "app": row.get("app"),
                "command": row.get("name"),
                "status": row.get("status") or "unknown",
                "args": _compact_for_log(args) if isinstance(args, dict) else None,
                "result": _compact_for_log(result)
                if isinstance(result, dict)
                else None,
                "error_message": error_message,
                "created": str(row["created"]) if row.get("created") else None,
                "updated": str(row["updated"]) if row.get("updated") else None,
                "log": log_lines,
            }
        except Exception as e:
            logger.error(f"Failed to get command log: {e}")
            raise

    @staticmethod
    async def dismiss_command_job(job_id: str) -> bool:
        """Hide a failed/canceled command from queue monitors without deleting history."""
        try:
            record_id = ensure_record_id(job_id)
            rows = await repo_query(
                "SELECT id, status FROM $job_id LIMIT 1",
                {"job_id": record_id},
            )
            if not rows:
                raise ValueError(f"Command job not found: {job_id}")

            current_status = rows[0].get("status") or "unknown"
            if current_status not in DISMISSIBLE_STATUSES:
                return False

            await repo_query(
                """
                UPDATE $job_id MERGE {
                    dismissed_at: time::now()
                }
                """,
                {"job_id": record_id},
            )
            logger.info(f"Dismissed command job from queue monitor: {job_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to dismiss command job: {e}")
            raise

    @staticmethod
    async def cancel_command_job(job_id: str) -> bool:
        """Cancel a queued or running command job."""
        try:
            record_id = ensure_record_id(job_id)
            rows = await repo_query(
                "SELECT id, status FROM $job_id LIMIT 1",
                {"job_id": record_id},
            )
            if not rows:
                raise ValueError(f"Command job not found: {job_id}")

            current_status = rows[0].get("status") or "unknown"
            if current_status in {"completed", "failed", "canceled"}:
                return False

            await repo_query(
                """
                UPDATE $job_id MERGE {
                    status: "canceled",
                    error_message: "Canceled by user",
                    canceled_at: time::now()
                }
                """,
                {"job_id": record_id},
            )
            logger.info(f"Canceled command job: {job_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to cancel command job: {e}")
            raise
