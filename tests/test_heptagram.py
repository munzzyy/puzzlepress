"""
pytest suite for the committed Heptagram bank (data/heptagram.json).
Checks schema, generator invariants, and cross-references against the
source wordlist independently of tools/gen_heptagram.py's own validation,
so a bug shared between generation and self-check would still be caught.
"""

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BANK_PATH = ROOT / "data" / "heptagram.json"
WORDLIST_PATH = ROOT / "data" / "wordlist.txt"

MIN_WORD_LEN = 4
MIN_WORDS = 20
MAX_WORDS = 60
MIN_BANK_SIZE = 150
PANGRAM_BONUS = 7


@pytest.fixture(scope="module")
def bank():
    assert BANK_PATH.exists(), "data/heptagram.json is missing; run tools/gen_heptagram.py"
    with open(BANK_PATH, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def puzzles(bank):
    assert "puzzles" in bank
    assert isinstance(bank["puzzles"], list)
    return bank["puzzles"]


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


def test_bank_meets_minimum_size(puzzles):
    assert len(puzzles) >= MIN_BANK_SIZE, (
        f"bank has {len(puzzles)} puzzles, contract requires >= {MIN_BANK_SIZE}"
    )


def test_no_duplicate_letter_sets(puzzles):
    letter_sets = [p["letters"] for p in puzzles]
    assert len(letter_sets) == len(set(letter_sets)), "duplicate letter set found in bank"


@pytest.mark.parametrize("index", range(200))
def test_puzzle_schema_and_invariants(puzzles, wordlist_set, index):
    if index >= len(puzzles):
        pytest.skip("bank smaller than parametrize range")
    p = puzzles[index]

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
    assert MIN_WORDS <= len(words) <= MAX_WORDS, (
        f"{letters}: {len(words)} words outside [{MIN_WORDS}, {MAX_WORDS}]"
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

    assert found_pangram, f"{letters}: no pangram among its words"
    assert computed_score == max_score, (
        f"{letters}: stored maxScore {max_score} != recomputed {computed_score}"
    )


def test_every_puzzle_is_winnable_at_full_completion(puzzles):
    """Finding every word always yields exactly maxScore (sanity on the score model)."""
    for p in puzzles:
        total = sum(score_word(w, p["letters"]) for w in p["words"])
        assert total == p["maxScore"]


def test_letters_and_centers_are_uppercase_ascii(puzzles):
    for p in puzzles:
        assert all("A" <= ch <= "Z" for ch in p["letters"])
        assert "A" <= p["center"] <= "Z"
