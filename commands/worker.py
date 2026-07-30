"""Worker-only command registration entrypoint.

The API imports individual command modules lazily to keep startup fast. The
background worker, however, must register every command before listening to the
queue. Passing this module to ``surreal-commands-worker --import-modules`` keeps
those two startup paths explicit and prevents jobs from remaining in ``new``.
"""

from commands import register_all

register_all()
