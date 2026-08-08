"""Schema and invariant tests for the committed Wordweave bank.

Run: pytest tests/test_wordweave.py
"""
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BANK_PATH = ROOT / "data" / "wordweave.json"

sys.path.insert(0, str(ROOT / "tools"))
import gen_wordweave as gen  # noqa: E402

DIFFICULTIES = ("easy", "medium", "hard")
MIN_WORD_LEN = gen.MIN_WORD_LEN
MIN_BANK_SIZE = gen.MIN_BANK_SIZE
WORD_RE = re.compile(r"^[A-Z]+$")

GRID_DIMS = {
    "easy": (gen.EASY_ROWS, gen.EASY_COLS),
    "medium": (gen.STD_ROWS, gen.STD_COLS),
    "hard": (gen.STD_ROWS, gen.STD_COLS),
}


@pytest.fixture(scope="module")
def bank():
    assert BANK_PATH.exists(), "data/wordweave.json is missing; run tools/gen_wordweave.py"
    return json.loads(BANK_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module", params=list(DIFFICULTIES))
def diff(request):
    return request.param


@pytest.fixture
def puzzles(bank, diff):
    return bank[diff]["puzzles"]


@pytest.fixture
def dims(diff):
    return GRID_DIMS[diff]


def test_bank_has_all_three_difficulty_sections(bank):
    assert set(bank) == set(DIFFICULTIES)
    for d in DIFFICULTIES:
        assert isinstance(bank[d], dict)
        assert isinstance(bank[d]["puzzles"], list)


def test_bank_meets_minimum_size(puzzles, diff):
    assert len(puzzles) >= MIN_BANK_SIZE, (
        f"{diff} bank has {len(puzzles)} puzzles, contract requires >= {MIN_BANK_SIZE}"
    )


def test_no_duplicate_grids_within_a_section(puzzles):
    grids = [tuple(p["grid"]) for p in puzzles]
    assert len(grids) == len(set(grids)), "two puzzles in the same section share an identical grid"


def test_no_duplicate_grids_across_sections(bank):
    seen = {}
    for d in DIFFICULTIES:
        for i, p in enumerate(bank[d]["puzzles"]):
            key = tuple(p["grid"])
            assert key not in seen, f"{d}[{i}] duplicates {seen.get(key)}'s grid"
            seen[key] = f"{d}[{i}]"


def test_themes_are_unique_within_a_section(puzzles):
    themes = [p["theme"] for p in puzzles]
    assert len(themes) == len(set(themes)), "duplicate theme name in section"


def test_easy_and_hard_theme_pools_never_overlap(bank):
    easy_themes = {p["theme"] for p in bank["easy"]["puzzles"]}
    hard_themes = {p["theme"] for p in bank["hard"]["puzzles"]}
    assert easy_themes.isdisjoint(hard_themes), "a theme is shared between the easy and hard pools"


def test_easy_grid_is_6x6(bank):
    for i, p in enumerate(bank["easy"]["puzzles"]):
        assert len(p["grid"]) == 6, f"easy puzzle {i} must have 6 rows"
        for row in p["grid"]:
            assert len(row) == 6, f"easy puzzle {i} row must have 6 columns"


def test_medium_and_hard_grids_are_8x6(bank):
    for d in ("medium", "hard"):
        for i, p in enumerate(bank[d]["puzzles"]):
            assert len(p["grid"]) == 8, f"{d} puzzle {i} must have 8 rows"
            for row in p["grid"]:
                assert len(row) == 6, f"{d} puzzle {i} row must have 6 columns"


def test_hard_puzzles_carry_at_least_six_target_words(bank):
    for i, p in enumerate(bank["hard"]["puzzles"]):
        total = 1 + len(p["words"])  # spangram plus theme words
        assert total >= gen.HARD_MIN_THEME_WORDS, (
            f"hard puzzle {i} has only {total} target words, contract requires a busier board"
        )


@pytest.mark.parametrize("index", range(0, 200))
def test_each_puzzle_schema_and_invariants(puzzles, dims, index):
    if index >= len(puzzles):
        pytest.skip("index beyond bank size")
    rows, cols = dims
    p = puzzles[index]

    assert isinstance(p["theme"], str) and p["theme"].strip()
    assert isinstance(p["spangram"], str) and WORD_RE.match(p["spangram"])
    assert isinstance(p["words"], list) and len(p["words"]) >= 3
    for w in p["words"]:
        assert WORD_RE.match(w), f"{w} is not alphabetic uppercase"
        assert len(w) >= MIN_WORD_LEN

    grid = p["grid"]
    assert len(grid) == rows, f"grid must have {rows} rows"
    for row in grid:
        assert len(row) == cols, f"every grid row must have {cols} columns"
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
            assert 0 <= r < rows and 0 <= c < cols, f"cell out of bounds in {word}"
            assert grid[r][c] == ch, f"grid letter does not match solution letter for {word}"
            key = (r, c)
            assert key not in used_cells, f"cell {key} claimed by more than one word"
            used_cells.add(key)
            if prev is not None:
                pr, pc = prev
                assert max(abs(pr - r), abs(pc - c)) == 1, f"non-adjacent step within {word}"
            prev = (r, c)

    # Every cell must belong to exactly one word: full tiling, no filler.
    assert len(used_cells) == rows * cols, "grid is not fully tiled by its words"

    # Spangram must run edge to edge.
    span_cells = solution[p["spangram"]]
    a, b = span_cells[0], span_cells[-1]
    touches_h = (a[1] == 0 and b[1] == cols - 1) or (a[1] == cols - 1 and b[1] == 0)
    touches_v = (a[0] == 0 and b[0] == rows - 1) or (a[0] == rows - 1 and b[0] == 0)
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


def test_every_puzzle_in_every_section_passes_full_invariants(bank):
    """Same checks as test_each_puzzle_schema_and_invariants, but walking the
    whole bank once instead of relying on the range(200) parametrize cap, so
    a bank larger than 200 puzzles per section is still fully covered."""
    for d in DIFFICULTIES:
        rows, cols = GRID_DIMS[d]
        for p in bank[d]["puzzles"]:
            grid = p["grid"]
            assert len(grid) == rows and all(len(row) == cols for row in grid)
            all_words = [p["spangram"]] + p["words"]
            used_cells = set()
            for word in all_words:
                cells = p["solution"][word]
                for (r, c), ch in zip(cells, word):
                    assert grid[r][c] == ch
                    assert (r, c) not in used_cells
                    used_cells.add((r, c))
            assert len(used_cells) == rows * cols


def test_spot_check_words_are_real(bank):
    wordlist_path = ROOT / "data" / "wordlist.txt"
    dictionary = {
        line.strip() for line in wordlist_path.read_text(encoding="utf-8").splitlines() if line.strip()
    }

    for d in DIFFICULTIES:
        sample = bank[d]["puzzles"][:10] + bank[d]["puzzles"][-10:]
        for p in sample:
            assert p["spangram"].lower() in dictionary, f"{d}: {p['spangram']} not a dictionary word"
            for w in p["words"]:
                assert w.lower() in dictionary, f"{d}: {w} not a dictionary word"


def test_attribution_file_mentions_wordlist():
    attribution = (ROOT / "data" / "ATTRIBUTION.md").read_text(encoding="utf-8")
    assert "wordlist.txt" in attribution


def test_generator_build_section_is_deterministic_for_a_seed():
    """Re-running the generator's build for a given seed reproduces the same
    puzzle set (order and content), independent of the committed bank file."""
    wordset = gen.load_wordset()
    clean_themes, _problems = gen.validate_themes(wordset)
    easy_themes = [t for t in clean_themes if t[0] in gen.EASY_NAMES]
    trie_words = [w for w in wordset if gen.MIN_WORD_LEN <= len(w) <= gen.MAX_BONUS_LEN]
    trie = gen.build_trie(trie_words)

    puzzles_a, failed_a = gen.build_section(easy_themes, gen.EASY_ROWS, gen.EASY_COLS, 20260810, trie)
    puzzles_b, failed_b = gen.build_section(easy_themes, gen.EASY_ROWS, gen.EASY_COLS, 20260810, trie)
    assert failed_a == failed_b
    assert [p["grid"] for p in puzzles_a] == [p["grid"] for p in puzzles_b]
