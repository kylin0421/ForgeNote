import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules, copy_metadata


project_root = Path.cwd().resolve()
if not (project_root / "pyproject.toml").exists():
    raise RuntimeError("Run PyInstaller from the ZhiXue repository root")

debug_build = os.environ.get("ZHIXUE_PYINSTALLER_DEBUG") == "1"

datas = [
    (str(project_root / "open_notebook" / "database" / "migrations"), "open_notebook/database/migrations"),
    (str(project_root / "open_notebook" / "ai" / "assets"), "open_notebook/ai/assets"),
]
datas += copy_metadata("imageio")
binaries = []
hiddenimports = (
    collect_submodules("api")
    + collect_submodules("commands")
    + collect_submodules("open_notebook.ai")
    + collect_submodules("tiktoken_ext")
)

# charset-normalizer's mypyc extension links to a hash-named companion module
# at the site-packages root. Its name changes between releases, so discover it
# instead of pinning the current hash.
for search_path in map(Path, sys.path):
    if not search_path.is_dir():
        continue
    for mypyc_binary in search_path.glob("*__mypyc*.pyd"):
        binaries.append((str(mypyc_binary), "."))

# These packages discover providers, commands, or templates dynamically, which
# PyInstaller cannot infer from ordinary import statements.
for package in (
    "ai_prompter",
    "content_core",
    "esperanto",
    "podcast_creator",
    "surreal_commands",
):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

for package in (
    "langchain_anthropic",
    "langchain_deepseek",
    "langchain_google_genai",
    "langchain_groq",
    "langchain_mistralai",
    "langchain_ollama",
    "langchain_openai",
):
    hiddenimports += collect_submodules(package)

a = Analysis(
    [str(project_root / "desktop" / "windows" / "launcher.py")],
    pathex=[str(project_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pytest", "IPython", "notebook"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ZhiXue",
    debug=debug_build,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=debug_build,
    icon=str(project_root / "frontend" / "src" / "app" / "favicon.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="ZhiXue",
)
