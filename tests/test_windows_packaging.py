"""Regression tests for the self-contained Windows distribution."""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_windows_bundle_collects_local_ai_providers() -> None:
    """Dynamic provider class paths must remain importable in the frozen app."""
    spec = (PROJECT_ROOT / "desktop" / "windows" / "forgenote.spec").read_text(
        encoding="utf-8"
    )

    assert 'collect_submodules("forgenote.ai")' in spec
