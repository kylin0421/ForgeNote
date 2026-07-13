"""Windows launcher for the self-contained ZhiXue distribution."""

from __future__ import annotations

import argparse
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

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


def run_component(component: str) -> int:
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
        managed = ManagedProcess(name=name, process=process, log_handle=log_handle)
        self.processes.append(managed)
        return managed

    @staticmethod
    def _ensure_running(managed: ManagedProcess) -> None:
        return_code = managed.process.poll()
        if return_code is not None:
            raise RuntimeError(f"{managed.name} exited with code {return_code}")

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
            time.sleep(2)
            self._ensure_running(worker)

            self._status("正在启动网页界面…")
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


def run_gui(stack: ZhiXueStack, open_browser: bool) -> int:
    import tkinter as tk
    from tkinter import messagebox

    root = tk.Tk()
    root.title(APP_TITLE)
    root.geometry("430x210")
    root.resizable(False, False)

    title = tk.Label(root, text=APP_TITLE, font=("Microsoft YaHei UI", 20, "bold"))
    title.pack(pady=(28, 12))
    status_var = tk.StringVar(value="正在准备启动…")
    status = tk.Label(root, textvariable=status_var, font=("Microsoft YaHei UI", 10))
    status.pack(pady=8)

    button_frame = tk.Frame(root)
    button_frame.pack(pady=18)
    open_button = tk.Button(
        button_frame,
        text="打开智学工坊",
        width=16,
        state=tk.DISABLED,
        command=lambda: webbrowser.open(FRONTEND_URL),
    )
    open_button.pack(side=tk.LEFT, padx=6)
    logs_button = tk.Button(
        button_frame,
        text="打开日志目录",
        width=14,
        command=lambda: os.startfile(stack.logs_dir),
    )
    logs_button.pack(side=tk.LEFT, padx=6)

    closing = threading.Event()

    def update_status(message: str) -> None:
        root.after(0, status_var.set, message)

    stack.status_callback = update_status

    def start_services() -> None:
        try:
            stack.start()
            root.after(0, lambda: open_button.config(state=tk.NORMAL))
            if open_browser and not closing.is_set():
                webbrowser.open(FRONTEND_URL)
        except Exception as exc:
            update_status("启动失败，请查看日志")
            error_message = f"{exc}\n\n日志目录：{stack.logs_dir}"
            root.after(
                0,
                lambda: messagebox.showerror("智学工坊启动失败", error_message),
            )

    def close() -> None:
        if closing.is_set():
            return
        closing.set()
        status_var.set("正在停止服务…")
        stack.stop()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", close)
    threading.Thread(target=start_services, name="zhixue-startup", daemon=True).start()
    root.mainloop()
    return 0


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
    return run_gui(stack, open_browser=not args.no_browser)


if __name__ == "__main__":
    raise SystemExit(main())
