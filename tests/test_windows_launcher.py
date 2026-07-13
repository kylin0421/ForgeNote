from pathlib import Path

from desktop.windows.launcher import ensure_config, read_env_file


def test_ensure_config_creates_and_preserves_encryption_key(tmp_path: Path):
    config_path = ensure_config(tmp_path)
    first = read_env_file(config_path)

    assert first["OPEN_NOTEBOOK_ENCRYPTION_KEY"]
    assert first["SURREAL_URL"] == "ws://127.0.0.1:8000/rpc"

    ensure_config(tmp_path)
    second = read_env_file(config_path)
    assert second["OPEN_NOTEBOOK_ENCRYPTION_KEY"] == first["OPEN_NOTEBOOK_ENCRYPTION_KEY"]


def test_read_env_file_ignores_comments_and_supports_quoted_values(tmp_path: Path):
    path = tmp_path / "config.env"
    path.write_text('# note\nA=one\nB="two words"\n', encoding="utf-8")

    assert read_env_file(path) == {"A": "one", "B": "two words"}
