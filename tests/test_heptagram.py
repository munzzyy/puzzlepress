"""
pytest suite for the committed Heptagram bank (data/heptagram.json).
Checks schema, per-difficulty generator invariants, and cross-references
against the source wordlist independently of tools/gen_heptagram.py's own
validation, so a bug shared between generation and self-check would still
be caught.

Bank shape: {"easy": {"puzzles": [...]}, "medium": {...}, "hard": {...}},
each section preserving the v1 inner shape ({"puzzles": [{letters, center,
words, maxScore}, ...]}) so pickDaily(bank[diff], EPOCH) works unchanged
per difficulty.
"""

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BANK_PATH = ROOT / "data" / "heptagram.json"
WORDLIST_PATH = ROOT / "data" / "wordlist.txt"

MIN_WORD_LEN = 4
PANGRAM_BONUS = 7
MIN_BANK_SIZE = 100  # contract minimum per difficulty

# Keep in sync with games/heptagram/core.js RANKS' Master pct.
WIN_PCT = 0.7
RARE_LETTERS = set("JQXZ")
HARD_WORD_COUNT_FLOOR = 40

DIFF_WORD_BOUNDS = {
    "easy": (20, 30),
    "medium": (20, 60),
    "hard": (20, 60),
}
DIFFICULTIES = ("easy", "medium", "hard")


@pytest.fixture(scope="module")
def bank():
    assert BANK_PATH.exists(), "data/heptagram.json is missing; run tools/gen_heptagram.py"
    with open(BANK_PATH, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def wordlist_set():
    with open(WORDLIST_PATH, encoding="utf-8") as f:
        return {line.strip().lower() for line in f}


def score_word(word, letters):
    """Independent re-implementation of the scoring rule for cross-checking."""
    length = len(word)
    base = 1 if length == 4 else length
    letters_set = set(letters.lower())
    is_pangram = letters_set.issubset(set(word.lower()))
    return base + (PANGRAM_BONUS if is_pangram else 0)


def non_pangram_score(words, letters):
    letters_set = set(letters.lower())
    total = 0
    for w in words:
        if not letters_set.issubset(set(w.lower())):
            total += score_word(w, letters)
    return total


def test_bank_has_all_three_difficulties(bank):
    assert set(bank.keys()) == set(DIFFICULTIES)
    for diff in DIFFICULTIES:
        assert set(bank[diff].keys()) == {"puzzles"}
        assert isinstance(bank[diff]["puzzles"], list)


@pytest.mark.parametrize("diff", DIFFICULTIES)
def test_bank_meets_minimum_size(bank, diff):
    puzzles = bank[diff]["puzzles"]
    assert len(puzzles) >= MIN_BANK_SIZE, (
        f"{diff} bank has {len(puzzles)} puzzles, contract requires >= {MIN_BANK_SIZE}"
    )


def test_no_duplicate_letter_sets_within_a_difficulty(bank):
    for diff in DIFFICULTIES:
        letter_sets = [p["letters"] for p in bank[diff]["puzzles"]]
        assert len(letter_sets) == len(set(letter_sets)), f"duplicate letter set found in {diff}"


def test_no_letter_set_shared_across_difficulties(bank):
    seen = {}
    for diff in DIFFICULTIES:
        for p in bank[diff]["puzzles"]:
            letters = p["letters"]
            assert letters not in seen, (
                f"letter set {letters!r} appears in both {seen.get(letters)!r} and {diff!r}"
            )
            seen[letters] = diff


@pytest.mark.parametrize("diff", DIFFICULTIES)
def test_puzzle_schema_and_invariants(bank, wordlist_set, diff):
    min_words, max_words = DIFF_WORD_BOUNDS[diff]
    for p in bank[diff]["puzzles"]:
        assert set(p.keys()) == {"letters", "center", "words", "maxScore"}

        letters = p["letters"]
        center = p["center"]
        words = p["words"]
        max_score = p["maxScore"]

        assert isinstance(letters, str) and len(letters) == 7
        assert letters.isalpha() and letters == letters.upper()
        assert len(set(letters)) == 7, "letters must be 7 distinct characters"

        assert isinstance(center, str) and len(center) == 1
        assert center in letters

        assert isinstance(words, list)
        assert len(words) == len(set(words)), "duplicate word in answer list"
        assert words == sorted(words), "words must be sorted"
        assert min_words <= len(words) <= max_words, (
            f"{diff} {letters}: {len(words)} words outside [{min_words}, {max_words}]"
        )

        letters_lower = set(letters.lower())
        center_lower = center.lower()
        found_pangram = False
        computed_score = 0

        for w in words:
            assert w == w.lower() and w.isalpha()
            assert len(w) >= MIN_WORD_LEN
            assert set(w).issubset(letters_lower), f"{w!r} uses a letter outside {letters!r}"
            assert center_lower in w, f"{w!r} is missing the center letter {center!r}"
            assert w in wordlist_set, f"{w!r} is not present in data/wordlist.txt"
            if letters_lower.issubset(set(w)):
                found_pangram = True
            computed_score += score_word(w, letters)

        assert found_pangram, f"{diff} {letters}: no pangram among its words"
        assert computed_score == max_score, (
            f"{diff} {letters}: stored maxScore {max_score} != recomputed {computed_score}"
        )


def test_every_puzzle_is_winnable_at_full_completion(bank):
    """Finding every word always yields exactly maxScore (sanity on the score model)."""
    for diff in DIFFICULTIES:
        for p in bank[diff]["puzzles"]:
            total = sum(score_word(w, p["letters"]) for w in p["words"])
            assert total == p["maxScore"]


def test_letters_and_centers_are_uppercase_ascii(bank):
    for diff in DIFFICULTIES:
        for p in bank[diff]["puzzles"]:
            assert all("A" <= ch <= "Z" for ch in p["letters"])
            assert "A" <= p["center"] <= "Z"


def test_easy_has_no_rare_letters(bank):
    for p in bank["easy"]["puzzles"]:
        assert not (set(p["letters"]) & RARE_LETTERS), (
            f"easy {p['letters']}: contains a rare letter, easy puzzles must use common letter sets"
        )


def test_easy_master_reachable_without_the_pangram(bank):
    """Every easy puzzle: finding all non-pangram words alone already clears
    the Master threshold, so a player never has to find the pangram to win."""
    for p in bank["easy"]["puzzles"]:
        floor = non_pangram_score(p["words"], p["letters"])
        assert floor >= WIN_PCT * p["maxScore"], (
            f"easy {p['letters']}: Master requires the pangram (non-pangram score "
            f"{floor} < {WIN_PCT} * {p['maxScore']})"
        )


def test_hard_has_word_count_or_rare_letter(bank):
    for p in bank["hard"]["puzzles"]:
        has_rare = bool(set(p["letters"]) & RARE_LETTERS)
        assert len(p["words"]) >= HARD_WORD_COUNT_FLOOR or has_rare, (
            f"hard {p['letters']}: needs >= {HARD_WORD_COUNT_FLOOR} words or a rare letter"
        )


def test_hard_master_requires_the_pangram(bank):
    """Every hard puzzle: finding all non-pangram words alone falls short of
    Master, so the pangram is mandatory to win, not just a bonus."""
    for p in bank["hard"]["puzzles"]:
        ceiling = non_pangram_score(p["words"], p["letters"])
        assert ceiling < WIN_PCT * p["maxScore"], (
            f"hard {p['letters']}: Master reachable without the pangram (non-pangram score "
            f"{ceiling} >= {WIN_PCT} * {p['maxScore']})"
        )
