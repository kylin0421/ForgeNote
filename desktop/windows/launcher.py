"""Windows launcher for the self-contained ZhiXue distribution."""

from __future__ import annotations

import argparse
import base64
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import tempfile
import urllib.error
import urllib.request
import webbrowser
from dataclasses import dataclass
from html import escape
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

APP_NAME = "ZhiXue"
APP_TITLE = "智学工坊"
FRONTEND_URL = "http://127.0.0.1:8502"
API_HEALTH_URL = "http://127.0.0.1:5055/health"


def application_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def default_data_root() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / APP_NAME
    return Path.home() / f".{APP_NAME.lower()}"


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def ensure_config(data_root: Path) -> Path:
    config_path = data_root / "config.env"
    data_root.mkdir(parents=True, exist_ok=True)
    if config_path.exists():
        return config_path

    config_path.write_text(
        "\n".join(
            [
                "# ZhiXue local configuration. Keep the encryption key stable.",
                f"OPEN_NOTEBOOK_ENCRYPTION_KEY={secrets.token_urlsafe(32)}",
                "SURREAL_URL=ws://127.0.0.1:8000/rpc",
                "SURREAL_USER=root",
                "SURREAL_PASSWORD=root",
                "SURREAL_NAMESPACE=open_notebook",
                "SURREAL_DATABASE=open_notebook",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return config_path


def wait_for_port(host: str, port: int, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            if sock.connect_ex((host, port)) == 0:
                return
        time.sleep(0.25)
    raise TimeoutError(f"Timed out waiting for {host}:{port}")


def wait_for_http(url: str, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if 200 <= response.status < 500:
                    return
        except (OSError, urllib.error.URLError) as exc:
            last_error = exc
        time.sleep(0.5)
    raise TimeoutError(f"Timed out waiting for {url}: {last_error}")


def port_is_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def component_command(component: str) -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, "--component", component]
    return [sys.executable, str(Path(__file__).resolve()), "--component", component]


def configure_utf8_stdio() -> None:
    """Keep Rich and other CLI libraries from writing child logs as GBK."""
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="backslashreplace")


def run_component(component: str) -> int:
    configure_utf8_stdio()

    if component == "api":
        import uvicorn

        from api.main import app

        uvicorn.run(app, host="127.0.0.1", port=5055, reload=False)
        return 0

    if component == "worker":
        from surreal_commands.cli.worker import main as worker_main

        import commands  # noqa: F401 - registers commands for the worker

        sys.argv = ["surreal-commands-worker", "--import-modules", "commands"]
        worker_main()
        return 0

    raise ValueError(f"Unknown component: {component}")


@dataclass
class ManagedProcess:
    name: str
    process: subprocess.Popen
    log_handle: object
    log_path: Path


class ZhiXueStack:
    def __init__(
        self,
        app_root: Path,
        data_root: Path,
        status_callback: Callable[[str], None] | None = None,
    ) -> None:
        self.app_root = app_root
        self.data_root = data_root
        self.status_callback = status_callback or (lambda _message: None)
        self.processes: list[ManagedProcess] = []
        self.logs_dir = data_root / "logs"
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.env = self._build_environment()

    def _status(self, message: str) -> None:
        self.status_callback(message)

    def _build_environment(self) -> dict[str, str]:
        config_path = ensure_config(self.data_root)
        env = os.environ.copy()
        for key, value in read_env_file(config_path).items():
            env.setdefault(key, value)

        app_data = self.data_root / "data"
        app_data.mkdir(parents=True, exist_ok=True)
        env["OPEN_NOTEBOOK_DATA_DIR"] = str(app_data)
        env["SURREAL_URL"] = "ws://127.0.0.1:8000/rpc"
        env["INTERNAL_API_URL"] = "http://127.0.0.1:5055"
        env["PORT"] = "8502"
        env["HOSTNAME"] = "127.0.0.1"
        env["NODE_ENV"] = "production"
        # The worker uses Rich and prints Unicode status symbols. A redirected
        # Windows child otherwise inherits the local GBK code page and crashes.
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"

        bundled_cache = self.app_root / "runtime" / "tiktoken-cache"
        if bundled_cache.exists():
            env["TIKTOKEN_CACHE_DIR"] = str(bundled_cache)

        ffmpeg_bin = self.app_root / "runtime" / "ffmpeg" / "bin"
        if ffmpeg_bin.exists():
            env["PATH"] = f"{ffmpeg_bin}{os.pathsep}{env.get('PATH', '')}"
        return env

    def _resolve_binary(self, bundled: Path, fallback: str) -> Path:
        candidate = self.app_root / bundled
        if candidate.exists():
            return candidate
        found = shutil.which(fallback)
        if found:
            return Path(found)
        raise FileNotFoundError(
            f"Missing {fallback}. Expected bundled binary at {candidate}."
        )

    def _frontend_server(self) -> Path:
        packaged = self.app_root / "frontend" / "server.js"
        source_build = self.app_root / "frontend" / ".next" / "standalone" / "server.js"
        for candidate in (packaged, source_build):
            if candidate.exists():
                return candidate
        raise FileNotFoundError("Next.js standalone server.js was not found")

    def _spawn(self, name: str, command: list[str], cwd: Path) -> ManagedProcess:
        log_path = self.logs_dir / f"{name}.log"
        log_handle = log_path.open("a", encoding="utf-8", buffering=1)
        log_handle.write(f"\n--- Starting {name} at {time.ctime()} ---\n")
        creation_flags = 0
        if sys.platform == "win32":
            creation_flags = subprocess.CREATE_NO_WINDOW
        process = subprocess.Popen(
            command,
            cwd=str(cwd),
            env=self.env,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            creationflags=creation_flags,
        )
        managed = ManagedProcess(
            name=name,
            process=process,
            log_handle=log_handle,
            log_path=log_path,
        )
        self.processes.append(managed)
        return managed

    @staticmethod
    def _ensure_running(managed: ManagedProcess) -> None:
        return_code = managed.process.poll()
        if return_code is not None:
            raise RuntimeError(f"{managed.name} exited with code {return_code}")

    @staticmethod
    def _wait_for_log_text(
        managed: ManagedProcess, expected: str, timeout: float
    ) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            ZhiXueStack._ensure_running(managed)
            try:
                content = managed.log_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                content = ""
            if expected in content:
                return
            time.sleep(0.25)
        raise TimeoutError(
            f"Timed out waiting for {managed.name} readiness marker: {expected}"
        )

    def start(self) -> None:
        occupied = [port for port in (8000, 5055, 8502) if not port_is_available(port)]
        if occupied:
            raise RuntimeError(
                "Required local ports are already in use: "
                + ", ".join(str(port) for port in occupied)
            )

        surreal = self._resolve_binary(
            Path("runtime/surreal/surreal.exe"), "surreal.exe"
        )
        node = self._resolve_binary(Path("runtime/node/node.exe"), "node.exe")
        frontend_server = self._frontend_server()
        database_dir = self.data_root / "surrealdb"
        database_dir.mkdir(parents=True, exist_ok=True)

        try:
            self._status("正在启动数据库…")
            db = self._spawn(
                "surrealdb",
                [
                    str(surreal),
                    "start",
                    "--bind",
                    "127.0.0.1:8000",
                    "--log",
                    "info",
                    "--user",
                    self.env.get("SURREAL_USER", "root"),
                    "--pass",
                    self.env.get("SURREAL_PASSWORD", "root"),
                    f"rocksdb:{database_dir / 'zhixue.db'}",
                ],
                self.app_root,
            )
            wait_for_port("127.0.0.1", 8000, 30)
            self._ensure_running(db)

            self._status("正在启动 API…")
            api = self._spawn("api", component_command("api"), self.app_root)
            wait_for_http(API_HEALTH_URL, 90)
            self._ensure_running(api)

            self._status("正在启动任务服务…")
            worker = self._spawn(
                "worker", component_command("worker"), self.app_root
            )
            self._wait_for_log_text(
                worker,
                "Starting LIVE query listener for new commands",
                timeout=60,
            )
            self._ensure_running(worker)

            self._status("正在启动应用界面…")
            frontend = self._spawn(
                "frontend", [str(node), str(frontend_server)], frontend_server.parent
            )
            wait_for_http(FRONTEND_URL, 60)
            self._ensure_running(frontend)
            self._status("智学工坊已启动")
        except Exception:
            self.stop()
            raise

    def stop(self) -> None:
        self._status("正在停止服务…")
        for managed in reversed(self.processes):
            if managed.process.poll() is None:
                managed.process.terminate()
        for managed in reversed(self.processes):
            try:
                managed.process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                managed.process.kill()
                managed.process.wait(timeout=5)
            finally:
                managed.log_handle.close()
        self.processes.clear()


def run_headless(stack: ZhiXueStack, open_browser: bool) -> int:
    stack.start()
    if open_browser:
        webbrowser.open(FRONTEND_URL)
    try:
        while True:
            time.sleep(1)
            stopped = [item.name for item in stack.processes if item.process.poll() is not None]
            if stopped:
                raise RuntimeError(f"Components stopped unexpectedly: {', '.join(stopped)}")
    except KeyboardInterrupt:
        return 0
    finally:
        stack.stop()


def run_smoke_test(stack: ZhiXueStack) -> int:
    stack.start()
    try:
        wait_for_http(API_HEALTH_URL, 5)
        wait_for_http(FRONTEND_URL, 5)
        return 0
    finally:
        stack.stop()


def desktop_page(status: str, detail: str | None = None, error: bool = False) -> str:
    accent = "#dc2626" if error else "#2563eb"
    symbol = "!" if error else "智"
    spinner = "" if error else '<div class="spinner" aria-hidden="true"></div>'
    detail_html = f'<div class="detail">{escape(detail)}</div>' if detail else ""
    action = (
        '<button onclick="pywebview.api.open_logs()">打开日志目录</button>'
        if error
        else ""
    )
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{APP_TITLE}</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; min-height: 100vh; display: grid; place-items: center;
      color: #172033; background: linear-gradient(145deg, #f7faff, #eef3fb);
      font-family: "Microsoft YaHei UI", "Segoe UI", sans-serif; }}
    main {{ width: min(520px, calc(100vw - 48px)); padding: 52px 44px;
      text-align: center; background: rgba(255,255,255,.92); border: 1px solid #dbe4f2;
      border-radius: 22px; box-shadow: 0 24px 70px rgba(35,58,100,.12); }}
    .mark {{ width: 64px; height: 64px; margin: 0 auto 20px; display: grid;
      place-items: center; border-radius: 18px; color: white; background: {accent};
      font-size: 29px; font-weight: 700; }}
    h1 {{ margin: 0; font-size: 28px; }}
    #status {{ margin: 18px 0 0; color: #526078; font-size: 15px; }}
    .detail {{ margin-top: 18px; padding: 14px; color: #7f1d1d; background: #fef2f2;
      border-radius: 10px; font-size: 13px; line-height: 1.65; white-space: pre-wrap;
      overflow-wrap: anywhere; text-align: left; }}
    .spinner {{ width: 28px; height: 28px; margin: 26px auto 0; border: 3px solid #dbe7fb;
      border-top-color: {accent}; border-radius: 50%; animation: spin .8s linear infinite; }}
    button {{ margin-top: 20px; padding: 10px 18px; border: 0; border-radius: 9px;
      color: white; background: {accent}; font-size: 14px; cursor: pointer; }}
    @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
  </style>
</head>
<body>
  <main><div class="mark">{symbol}</div><h1>{APP_TITLE}</h1>
    <p id="status">{escape(status)}</p>{spinner}{detail_html}{action}</main>
  <script>
    window.setStatus = message => {{ document.getElementById('status').textContent = message; }};
  </script>
</body>
</html>"""


class DesktopBridge:
    def __init__(self, logs_dir: Path) -> None:
        # pywebview recursively exposes public js_api attributes. Keep native
        # objects private so API discovery only sees the intended methods.
        self._logs_dir = logs_dir
        self._window: Any | None = None

    def bind_window(self, window: Any) -> None:
        self._window = window

    def open_logs(self) -> bool:
        self._logs_dir.mkdir(parents=True, exist_ok=True)
        if sys.platform == "win32":
            os.startfile(self._logs_dir)  # type: ignore[attr-defined]
        else:
            webbrowser.open(self._logs_dir.as_uri())
        return True

    def _save_destination(self, filename: str) -> Path | None:
        if self._window is None:
            raise RuntimeError("Desktop window is not ready")

        safe_filename = Path(filename or "export").name.strip() or "export"
        suffix = Path(safe_filename).suffix
        file_types = (
            (f"{suffix[1:].upper()} files (*{suffix})", "All files (*.*)")
            if suffix
            else ("All files (*.*)",)
        )
        downloads = Path.home() / "Downloads"
        selected = self._window.create_file_dialog(
            dialog_type=30,
            directory=str(downloads if downloads.exists() else Path.home()),
            save_filename=safe_filename,
            file_types=file_types,
        )
        if not selected:
            return None
        return Path(selected[0])

    @staticmethod
    def _write_stream(destination: Path, source: Any) -> int:
        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                dir=destination.parent,
                prefix=f".{destination.name}.",
                suffix=".part",
                delete=False,
            ) as output:
                temp_path = Path(output.name)
                shutil.copyfileobj(source, output, length=1024 * 1024)
            size = temp_path.stat().st_size
            os.replace(temp_path, destination)
            return size
        except Exception:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)
            raise

    @staticmethod
    def _validate_local_api_url(url: str) -> None:
        parsed = urlparse(url)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "localhost"}
            or parsed.port != 5055
            or not parsed.path.startswith("/api/")
        ):
            raise ValueError("Desktop downloads are limited to the local ZhiXue API")

    def save_download(
        self,
        url: str,
        filename: str,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Stream a local API asset to a path selected with the native dialog."""
        try:
            self._validate_local_api_url(url)
            destination = self._save_destination(filename)
            if destination is None:
                return {"ok": False, "cancelled": True}

            allowed_headers = {"authorization", "accept"}
            request_headers = {
                str(key): str(value)
                for key, value in (headers or {}).items()
                if str(key).lower() in allowed_headers
            }
            request = urllib.request.Request(url, headers=request_headers)
            with urllib.request.urlopen(request, timeout=300) as response:
                size = self._write_stream(destination, response)
            return {"ok": True, "path": str(destination), "size": size}
        except Exception as exc:
            return {"ok": False, "cancelled": False, "error": str(exc)}

    def save_blob(self, filename: str, data_url: str) -> dict[str, Any]:
        """Save a small browser-generated Blob through the native dialog."""
        try:
            header, encoded = data_url.split(",", 1)
            if not header.startswith("data:") or ";base64" not in header:
                raise ValueError("Expected a base64 data URL")
            if len(encoded) > 70 * 1024 * 1024:
                raise ValueError("Browser-generated export exceeds the 50 MB desktop limit")

            destination = self._save_destination(filename)
            if destination is None:
                return {"ok": False, "cancelled": True}

            payload = base64.b64decode(encoded, validate=True)
            with tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024) as source:
                source.write(payload)
                source.seek(0)
                size = self._write_stream(destination, source)
            return {"ok": True, "path": str(destination), "size": size}
        except Exception as exc:
            return {"ok": False, "cancelled": False, "error": str(exc)}


def show_native_error(message: str) -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, APP_TITLE, 0x10)
    except Exception:
        pass


def configure_desktop_webview(webview_module) -> None:
    """Enable native Save As handling for downloads in the desktop app."""
    webview_module.settings["ALLOW_DOWNLOADS"] = True


def run_desktop(stack: ZhiXueStack) -> int:
    import webview

    desktop_log_path = stack.logs_dir / "desktop.log"

    def desktop_log(message: str) -> None:
        try:
            with desktop_log_path.open("a", encoding="utf-8") as log_file:
                log_file.write(f"[{time.ctime()}] {message}\n")
        except OSError:
            pass

    configure_desktop_webview(webview)
    desktop_log("Creating desktop window")
    bridge = DesktopBridge(stack.logs_dir)
    window = webview.create_window(
        APP_TITLE,
        html=desktop_page("正在准备本地服务…"),
        js_api=bridge,
        width=1360,
        height=860,
        min_size=(1024, 680),
        maximized=True,
        background_color="#f7faff",
        text_select=True,
        zoomable=True,
    )
    if window is None:
        raise RuntimeError("Could not create the desktop application window")
    bridge.bind_window(window)

    closing = threading.Event()
    state = {"failed": False}

    def update_status(message: str) -> None:
        if closing.is_set():
            return
        try:
            encoded = json.dumps(message, ensure_ascii=False)
            window.evaluate_js(f"window.setStatus?.({encoded})")
        except Exception:
            pass

    def show_startup_error(exc: Exception) -> None:
        state["failed"] = True
        desktop_log(f"Startup failed: {exc!r}")
        detail = f"{exc}\n\n日志目录：{stack.logs_dir}"
        try:
            window.load_html(desktop_page("启动失败，请查看日志", detail, error=True))
        except Exception:
            show_native_error(detail)

    def start_services_and_monitor() -> None:
        desktop_log("Service startup callback invoked")
        try:
            stack.start()
            desktop_log("Local services are ready")
            if not closing.is_set():
                window.load_url(FRONTEND_URL)
        except Exception as exc:
            show_startup_error(exc)
            return

        while not closing.wait(1):
            stopped = [
                item.name for item in stack.processes if item.process.poll() is not None
            ]
            if stopped:
                show_startup_error(
                    RuntimeError(f"后台服务意外停止：{', '.join(stopped)}")
                )
                stack.stop()
                return

    stack.status_callback = update_status
    try:
        desktop_log("Starting WebView event loop")
        webview.start(
            start_services_and_monitor,
            gui="edgechromium",
            private_mode=False,
            storage_path=str(stack.data_root / "webview"),
        )
    except Exception as exc:
        state["failed"] = True
        desktop_log(f"WebView failed: {exc!r}")
        show_native_error(
            f"无法启动智学工坊桌面窗口：{exc}\n\n"
            "请确认 Microsoft Edge WebView2 Runtime 已安装。"
        )
    finally:
        desktop_log("Stopping desktop stack")
        closing.set()
        stack.stop()
    return 1 if state["failed"] else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start the ZhiXue desktop stack")
    parser.add_argument("--component", choices=("api", "worker"))
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--smoke-test", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.component:
        return run_component(args.component)

    app_root = application_root()
    data_root = (args.data_dir or default_data_root()).expanduser().resolve()
    stack = ZhiXueStack(app_root=app_root, data_root=data_root)
    if args.smoke_test:
        return run_smoke_test(stack)
    if args.headless:
        return run_headless(stack, open_browser=not args.no_browser)
    return run_desktop(stack)


if __name__ == "__main__":
    raise SystemExit(main())
