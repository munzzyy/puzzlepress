"""The shared word blocklist, read straight from assets/blocklist.js so the games and the generators can't drift apart."""

import re
from pathlib import Path

_JS = Path(__file__).resolve().parent.parent / "assets" / "blocklist.js"

BLOCKED_WORDS = frozenset(re.findall(r'"([a-z]+)"', _JS.read_text(encoding="utf-8").split("new Set(", 1)[1]))
