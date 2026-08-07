"""Schema and invariant checks for the committed Wordweave bank."""

import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
BANK_PATH = REPO_ROOT / "data" / "wordweave.json"

ROWS, COLS = 8, 6
MIN_WORD_LEN = 4
WORD_RE = re.compile(r"^[A-Z]+$")


@pytest.fixture(scope="module")
def bank():
    assert BANK_PATH.exists(), "data/wordweave.json is missing; run tools/gen_wordweave.py"
    with open(BANK_PATH, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def puzzles(bank):
    assert "puzzles" in bank
    assert isinstance(bank["puzzles"], list)
    return bank["puzzles"]


def test_bank_meets_minimum_size(puzzles):
    assert len(puzzles) >= 100, f"wordweave bank has only {len(puzzles)} puzzles, contract requires 100+"


def test_no_duplicate_grids(puzzles):
    grids = [tuple(p["grid"]) for p in puzzles]
    assert len(grids) == len(set(grids)), "two puzzles share an identical grid"


def test_themes_are_reasonably_varied(puzzles):
    themes = [p["theme"] for p in puzzles]
    # Every theme should be unique; repeats would make the daily rotation stale.
    assert len(themes) == len(set(themes)), "duplicate theme name in bank"


@pytest.mark.parametrize("index", range(0, 10000))
def test_each_puzzle_schema_and_invariants(puzzles, index):
    if index >= len(puzzles):
        pytest.skip("index beyond bank size")
    p = puzzles[index]

    assert isinstance(p["theme"], str) and p["theme"].strip()
    assert isinstance(p["spangram"], str) and WORD_RE.match(p["spangram"])
    assert isinstance(p["words"], list) and len(p["words"]) >= 3
    for w in p["words"]:
        assert WORD_RE.match(w), f"{w} is not alphabetic uppercase"
        assert len(w) >= MIN_WORD_LEN

    grid = p["grid"]
    assert len(grid) == ROWS, "grid must have 8 rows"
    for row in grid:
        assert len(row) == COLS, "every grid row must have 6 columns"
        assert WORD_RE.match(row), "grid rows must be uppercase letters only"

    all_words = [p["spangram"]] + p["words"]
    assert len(all_words) == len(set(all_words)), "duplicate word within a puzzle"

    solution = p["solution"]
    assert set(solution.keys()) == set(all_words), "solution must cover spangram + every word"

    used_cells = set()
    for word in all_words:
        cells = solution[word]
        assert len(cells) == len(word), f"solution path length mismatch for {word}"
        prev = None
        for (r, c), ch in zip(cells, word):
            assert 0 <= r < ROWS and 0 <= c < COLS, f"cell out of bounds in {word}"
            assert grid[r][c] == ch, f"grid letter does not match solution letter for {word}"
            key = (r, c)
            assert key not in used_cells, f"cell {key} claimed by more than one word"
            used_cells.add(key)
            if prev is not None:
                pr, pc = prev
                assert max(abs(pr - r), abs(pc - c)) == 1, f"non-adjacent step within {word}"
            prev = (r, c)

    # Every cell must belong to exactly one word: full tiling, no filler.
    assert len(used_cells) == ROWS * COLS, "grid is not fully tiled by its words"

    # Spangram must run edge to edge.
    span_cells = solution[p["spangram"]]
    a, b = span_cells[0], span_cells[-1]
    touches_h = (a[1] == 0 and b[1] == COLS - 1) or (a[1] == COLS - 1 and b[1] == 0)
    touches_v = (a[0] == 0 and b[0] == ROWS - 1) or (a[0] == ROWS - 1 and b[0] == 0)
    assert touches_h or touches_v, "spangram does not span two opposite edges"

    # Bonus words: valid extras, never a theme word, never too short.
    bonus = p.get("bonusWords", [])
    assert isinstance(bonus, list)
    theme_word_set = set(all_words)
    for w in bonus:
        assert WORD_RE.match(w)
        assert len(w) >= MIN_WORD_LEN
        assert w not in theme_word_set, f"bonus word {w} duplicates a theme word"
    assert len(bonus) == len(set(bonus)), "duplicate bonus word"


def test_spot_check_words_are_real(puzzles):
    wordlist_path = REPO_ROOT / "data" / "wordlist.txt"
    with open(wordlist_path, encoding="utf-8") as f:
        dictionary = {line.strip() for line in f if line.strip()}

    sample = puzzles[:15] + puzzles[-15:]
    for p in sample:
        assert p["spangram"].lower() in dictionary, f"{p['spangram']} not a dictionary word"
        for w in p["words"]:
            assert w.lower() in dictionary, f"{w} not a dictionary word"


def test_attribution_file_mentions_wordlist():
    attribution = (REPO_ROOT / "data" / "ATTRIBUTION.md").read_text(encoding="utf-8")
    assert "wordlist.txt" in attribution
