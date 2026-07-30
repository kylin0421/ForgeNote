from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_shell_worker_entrypoints_import_registration_module():
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
    supervisord = (ROOT / "supervisord.conf").read_text(encoding="utf-8")

    assert makefile.count("--import-modules commands.worker") == 2
    assert "--import-modules commands.worker" in supervisord


def test_readme_worker_command_matches_runtime_entrypoint():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")

    assert "--import-modules commands.worker" in readme


def test_docker_runtime_installs_chinese_video_font():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "fonts-noto-cjk" in dockerfile
