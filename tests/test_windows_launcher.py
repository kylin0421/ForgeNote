from io import BytesIO
from pathlib import Path
from unittest.mock import Mock

from desktop.windows.launcher import (
    DesktopBridge,
    ManagedProcess,
    ZhiXueStack,
    configure_desktop_webview,
    desktop_page,
    ensure_config,
    read_env_file,
)


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


def test_stack_forces_utf8_for_windows_child_processes(tmp_path: Path):
    stack = ZhiXueStack(tmp_path / "app", tmp_path / "profile")

    assert stack.env["PYTHONUTF8"] == "1"
    assert stack.env["PYTHONIOENCODING"] == "utf-8"


def test_desktop_page_is_utf8_and_escapes_error_details():
    page = desktop_page("正在启动", "<script>bad()</script>", error=True)

    assert '<meta charset="utf-8">' in page
    assert "<script>bad()</script>" not in page
    assert "&lt;script&gt;bad()&lt;/script&gt;" in page
    assert "pywebview.api.open_logs()" in page


def test_desktop_webview_enables_native_downloads():
    webview_module = Mock()
    webview_module.settings = {"ALLOW_DOWNLOADS": False}

    configure_desktop_webview(webview_module)

    assert webview_module.settings["ALLOW_DOWNLOADS"] is True


def test_desktop_bridge_saves_browser_blob_with_native_dialog(tmp_path: Path):
    destination = tmp_path / "mind-map.md"
    window = Mock()
    window.create_file_dialog.return_value = (str(destination),)
    bridge = DesktopBridge(tmp_path / "logs")
    bridge.bind_window(window)

    assert not hasattr(bridge, "window")
    assert not hasattr(bridge, "logs_dir")

    result = bridge.save_blob(
        "mind-map.md",
        "data:text/markdown;base64,IyBUZXN0Cg==",
    )

    assert result["ok"] is True
    assert result["size"] == len(b"# Test\n")
    assert destination.read_bytes() == b"# Test\n"


def test_desktop_bridge_streams_only_local_api_downloads(tmp_path: Path, monkeypatch):
    destination = tmp_path / "podcast.wav"
    window = Mock()
    window.create_file_dialog.return_value = (str(destination),)
    bridge = DesktopBridge(tmp_path / "logs")
    bridge.bind_window(window)
    monkeypatch.setattr(
        "desktop.windows.launcher.urllib.request.urlopen",
        lambda request, timeout: BytesIO(b"RIFF-test"),
    )

    result = bridge.save_download(
        "http://127.0.0.1:5055/api/podcasts/episodes/test/audio/wav",
        "podcast.wav",
        {"Authorization": "Bearer test"},
    )

    assert result["ok"] is True
    assert destination.read_bytes() == b"RIFF-test"

    rejected = bridge.save_download(
        "https://example.com/private",
        "private.bin",
    )
    assert rejected["ok"] is False
    assert "local ZhiXue API" in rejected["error"]


def test_worker_readiness_waits_for_live_query_marker(tmp_path: Path):
    log_path = tmp_path / "worker.log"
    log_path.write_text(
        "  ✅ Imported: commands\nStarting LIVE query listener for new commands...\n",
        encoding="utf-8",
    )
    process = Mock()
    process.poll.return_value = None
    managed = ManagedProcess(
        name="worker",
        process=process,
        log_handle=Mock(),
        log_path=log_path,
    )

    ZhiXueStack._wait_for_log_text(
        managed, "Starting LIVE query listener for new commands", timeout=0.1
    )


def test_stack_defers_worker_until_core_services_are_ready(tmp_path: Path, monkeypatch):
    events = []
    stack = ZhiXueStack(tmp_path / "app", tmp_path / "profile")

    monkeypatch.setattr(
        "desktop.windows.launcher.port_is_available", lambda _port: True
    )
    monkeypatch.setattr(
        "desktop.windows.launcher.wait_for_port",
        lambda _host, port, _timeout: events.append(f"wait:{port}"),
    )
    monkeypatch.setattr(
        "desktop.windows.launcher.wait_for_http",
        lambda url, _timeout: events.append(f"wait:{url}"),
    )
    monkeypatch.setattr(stack, "_resolve_binary", lambda *_args: tmp_path / "bin")
    monkeypatch.setattr(stack, "_frontend_server", lambda: tmp_path / "server.js")
    monkeypatch.setattr(
        stack,
        "_wait_for_log_text",
        lambda managed, _expected, timeout: events.append(f"wait:{managed.name}"),
    )

    def fake_spawn(name, _command, _cwd):
        events.append(f"spawn:{name}")
        process = Mock()
        process.poll.return_value = None
        managed = ManagedProcess(name, process, Mock(), tmp_path / f"{name}.log")
        stack.processes.append(managed)
        return managed

    monkeypatch.setattr(stack, "_spawn", fake_spawn)

    stack.start()

    assert events == [
        "spawn:surrealdb",
        "wait:8000",
        "spawn:api",
        "spawn:frontend",
        "wait:http://127.0.0.1:5055/health",
        "wait:http://127.0.0.1:8502",
        "spawn:worker",
        "wait:worker",
    ]


def test_desktop_start_does_not_block_on_worker_warmup(tmp_path: Path, monkeypatch):
    events = []
    stack = ZhiXueStack(tmp_path / "app", tmp_path / "profile")

    monkeypatch.setattr(
        "desktop.windows.launcher.port_is_available", lambda _port: True
    )
    monkeypatch.setattr("desktop.windows.launcher.wait_for_port", lambda *_args: None)
    monkeypatch.setattr("desktop.windows.launcher.wait_for_http", lambda *_args: None)
    monkeypatch.setattr(stack, "_resolve_binary", lambda *_args: tmp_path / "bin")
    monkeypatch.setattr(stack, "_frontend_server", lambda: tmp_path / "server.js")
    monkeypatch.setattr(
        stack,
        "_wait_for_log_text",
        lambda *_args, **_kwargs: events.append("wait:worker"),
    )

    def fake_spawn(name, _command, _cwd):
        process = Mock()
        process.poll.return_value = None
        managed = ManagedProcess(name, process, Mock(), tmp_path / f"{name}.log")
        stack.processes.append(managed)
        return managed

    monkeypatch.setattr(stack, "_spawn", fake_spawn)

    stack.start(wait_for_worker=False)

    assert "wait:worker" not in events
