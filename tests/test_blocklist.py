import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from blocklist import BLOCKED_WORDS  # noqa: E402
import gen_heptagram  # noqa: E402
import gen_wordweave  # noqa: E402


def test_blocklist_reads_the_list_the_games_use():
    assert len(BLOCKED_WORDS) > 100
    assert {"rape", "retard", "porn"} <= BLOCKED_WORDS
    assert all(w.isalpha() and w.islower() for w in BLOCKED_WORDS)


def test_blocklist_holds_words_edgeways_and_wordrow_would_otherwise_take():
    assert {"fuck", "motherfucker", "shithead", "squaws", "retardate", "chinkier", "kraut", "pussy"} <= BLOCKED_WORDS


def test_heptagram_generator_never_offers_a_blocked_word(tmp_path):
    wordlist = tmp_path / "words.txt"
    wordlist.write_text("rapist\npianist\nporn\nhorn\n", encoding="utf-8")
    assert gen_heptagram.load_wordlist(wordlist) == ["pianist", "horn"]


def test_wordweave_generator_blocklist_covers_the_shared_list():
    assert BLOCKED_WORDS <= gen_wordweave.BLOCKLIST
