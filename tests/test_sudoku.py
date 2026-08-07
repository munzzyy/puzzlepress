"""Bank tests for sudoku: schema, invariants, uniqueness and grading
spot-checks against the committed data/sudoku.json."""

import importlib.util
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(ROOT, "data", "sudoku.json")
GEN_PATH = os.path.join(ROOT, "tools", "gen_sudoku.py")

spec = importlib.util.spec_from_file_location("gen_sudoku", GEN_PATH)
gen_sudoku = importlib.util.module_from_spec(spec)
sys.modules["gen_sudoku"] = gen_sudoku
spec.loader.exec_module(gen_sudoku)

DIFFICULTIES = ("easy", "medium", "hard")
MIN_PER_DIFFICULTY = 90


def load_bank():
    with open(DATA_PATH) as f:
        return json.load(f)


def test_bank_file_exists():
    assert os.path.isfile(DATA_PATH)


def test_schema_has_all_difficulties():
    bank = load_bank()
    assert set(bank.keys()) == set(DIFFICULTIES)
    for difficulty in DIFFICULTIES:
        assert "puzzles" in bank[difficulty]
        assert isinstance(bank[difficulty]["puzzles"], list)


def test_bank_meets_minimum_size():
    bank = load_bank()
    for difficulty in DIFFICULTIES:
        count = len(bank[difficulty]["puzzles"])
        assert count >= MIN_PER_DIFFICULTY, (
            f"{difficulty}: only {count} puzzles, need >= {MIN_PER_DIFFICULTY}"
        )


def test_every_entry_has_valid_shape():
    bank = load_bank()
    for difficulty in DIFFICULTIES:
        for entry in bank[difficulty]["puzzles"]:
            assert set(entry.keys()) == {"puzzle", "solution"}
            assert isinstance(entry["puzzle"], str)
            assert isinstance(entry["solution"], str)
            assert len(entry["puzzle"]) == 81
            assert len(entry["solution"]) == 81
            assert all(ch in "0123456789" for ch in entry["puzzle"])
            assert all(ch in "123456789" for ch in entry["solution"])


def test_every_solution_is_a_valid_completed_grid():
    bank = load_bank()
    for difficulty in DIFFICULTIES:
        for entry in bank[difficulty]["puzzles"]:
            solution = [int(ch) for ch in entry["solution"]]
            assert gen_sudoku.is_valid_solution(solution), (
                f"{difficulty}: invalid solution grid {entry['solution']}"
            )


def test_every_puzzle_agrees_with_its_solution():
    bank = load_bank()
    for difficulty in DIFFICULTIES:
        for entry in bank[difficulty]["puzzles"]:
            puzzle = [int(ch) for ch in entry["puzzle"]]
            solution = [int(ch) for ch in entry["solution"]]
            assert gen_sudoku.clues_match_solution(puzzle, solution), (
                f"{difficulty}: puzzle clues disagree with solution"
            )


def test_every_puzzle_has_a_unique_solution():
    bank = load_bank()
    for difficulty in DIFFICULTIES:
        for entry in bank[difficulty]["puzzles"]:
            puzzle = [int(ch) for ch in entry["puzzle"]]
            assert gen_sudoku.count_solutions(puzzle, limit=2) == 1, (
                f"{difficulty}: puzzle does not have exactly one solution"
            )


def test_every_puzzle_grades_at_its_labeled_difficulty():
    bank = load_bank()
    for difficulty in DIFFICULTIES:
        for entry in bank[difficulty]["puzzles"]:
            puzzle = [int(ch) for ch in entry["puzzle"]]
            graded = gen_sudoku.grade_puzzle(puzzle)
            assert graded == difficulty, (
                f"puzzle labeled {difficulty} actually grades as {graded}"
            )


def test_no_duplicate_puzzles_within_a_difficulty():
    bank = load_bank()
    for difficulty in DIFFICULTIES:
        puzzles = [entry["puzzle"] for entry in bank[difficulty]["puzzles"]]
        assert len(puzzles) == len(set(puzzles)), f"{difficulty}: duplicate puzzle strings"


def clue_count(puzzle_str):
    return sum(1 for ch in puzzle_str if ch != "0")


def test_clue_counts_are_sane_per_difficulty():
    # Loose sanity bounds, not tight technique assertions (those live in the
    # grading test above): a real puzzle has at least 17 givens (the proven
    # sudoku minimum) and is never a completely filled grid.
    bank = load_bank()
    for difficulty in DIFFICULTIES:
        for entry in bank[difficulty]["puzzles"]:
            given = clue_count(entry["puzzle"])
            assert 17 <= given <= 80

    # Easy puzzles should on average carry more givens than hard ones.
    def avg_clues(difficulty):
        entries = bank[difficulty]["puzzles"]
        return sum(clue_count(e["puzzle"]) for e in entries) / len(entries)

    assert avg_clues("easy") > avg_clues("medium") > avg_clues("hard")


def test_peers_geometry_matches_core_js_expectations():
    # A cross-check that the Python peer/group geometry used for grading
    # matches the same 20-peer rule the JS core relies on.
    peers0 = gen_sudoku.PEERS[0]
    assert len(peers0) == 20
    assert 0 not in peers0
