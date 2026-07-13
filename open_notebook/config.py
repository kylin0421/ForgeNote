import os
from pathlib import Path

# ROOT DATA FOLDER
DATA_FOLDER = str(
    Path(os.environ.get("OPEN_NOTEBOOK_DATA_DIR", "./data")).expanduser().resolve()
)

# LANGGRAPH CHECKPOINT FILE
sqlite_folder = Path(DATA_FOLDER) / "sqlite-db"
sqlite_folder.mkdir(parents=True, exist_ok=True)
LANGGRAPH_CHECKPOINT_FILE = str(sqlite_folder / "checkpoints.sqlite")

# UPLOADS FOLDER
UPLOADS_FOLDER = str(Path(DATA_FOLDER) / "uploads")
Path(UPLOADS_FOLDER).mkdir(parents=True, exist_ok=True)

# TIKTOKEN CACHE FOLDER
# Reads TIKTOKEN_CACHE_DIR from the environment so Docker can redirect the cache
# to a path outside /data/ (which is typically volume-mounted and would hide the
# pre-baked encoding baked into the image at build time).
TIKTOKEN_CACHE_DIR = os.environ.get("TIKTOKEN_CACHE_DIR", "").strip() or str(
    Path(DATA_FOLDER) / "tiktoken-cache"
)
Path(TIKTOKEN_CACHE_DIR).mkdir(parents=True, exist_ok=True)
