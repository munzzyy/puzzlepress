"""
Independent checks on the committed Edgeways bank and its runtime
dictionary. These re-derive every invariant from scratch rather than
calling back into tools/gen_edgeways.py, so a bug shared between the
generator and its own self-check can't slip through unnoticed.
"""
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BANK_PATH = ROOT / "data" / "edgeways.json"
DICTIONARY_PATH = ROOT / "games" / "edgeways" / "words.json"

MIN_BANK_SIZE = 120


@pytest.fixture(scope="module")
def bank():
    with open(BANK_PATH, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def puzzles(bank):
    return bank["puzzles"]


@pytest.fixture(scope="module")
def dictionary():
    with open(DICTIONARY_PATH, encoding="utf-8") as f:
        words = json.load(f)
    return set(words), words


def side_of_map(sides):
    mapping = {}
    for i, side in enumerate(sides):
        for ch in side:
            mapping[ch] = i
    return mapping


def test_bank_file_exists_and_parses(bank):
    assert isinstance(bank, dict)
    assert "puzzles" in bank


def test_bank_meets_minimum_size(puzzles):
    assert len(puzzles) >= MIN_BANK_SIZE, (
        f"bank has {len(puzzles)} puzzles, contract requires >= {MIN_BANK_SIZE}"
    )


def test_every_puzzle_has_the_right_shape(puzzles):
    for p in puzzles:
        assert set(p.keys()) == {"sides", "par", "solution"}
        assert isinstance(p["sides"], list)
        assert len(p["sides"]) == 4
        for side in p["sides"]:
            assert isinstance(side, str)
            assert len(side) == 3
            assert side.isalpha()
            assert side == side.upper()
        assert isinstance(p["par"], int)
        assert p["par"] >= 1
        assert isinstance(p["solution"], list)
        assert len(p["solution"]) == p["par"]


def test_each_board_has_twelve_distinct_letters(puzzles):
    for p in puzzles:
        all_letters = "".join(p["sides"])
        assert len(all_letters) == 12
        assert len(set(all_letters)) == 12, f"letters repeat across sides: {p['sides']}"


def test_no_duplicate_boards(puzzles):
    boards = [tuple(sorted(p["sides"])) for p in puzzles]
    assert len(boards) == len(set(boards)), "bank contains duplicate boards"


def test_solution_words_are_at_least_three_letters(puzzles):
    for p in puzzles:
        for word in p["solution"]:
            assert len(word) >= 3, f"solution word too short: {word}"
            assert word.isalpha()
            assert word == word.upper()


def test_solution_chain_rule_holds(puzzles):
    for p in puzzles:
        solution = p["solution"]
        for prev, nxt in zip(solution, solution[1:]):
            assert nxt[0] == prev[-1], (
                f"chain broken between {prev!r} and {nxt!r} in {p['sides']}"
            )


def test_solution_never_jumps_to_the_same_side_twice_in_a_row(puzzles):
    for p in puzzles:
        side_of = side_of_map(p["sides"])
        for word in p["solution"]:
            for a, b in zip(word, word[1:]):
                assert a in side_of, f"letter {a} not on board {p['sides']}"
                assert b in side_of, f"letter {b} not on board {p['sides']}"
                assert side_of[a] != side_of[b], (
                    f"{a}->{b} shares a side in word {word!r} on board {p['sides']}"
                )


def test_solution_uses_only_board_letters(puzzles):
    for p in puzzles:
        board_letters = set("".join(p["sides"]))
        for word in p["solution"]:
            assert set(word) <= board_letters, (
                f"word {word!r} uses a letter off the board {p['sides']}"
            )


def test_solution_covers_every_board_letter(puzzles):
    for p in puzzles:
        board_letters = set("".join(p["sides"]))
        used = set("".join(p["solution"]))
        assert used == board_letters, (
            f"solution {p['solution']} does not cover every letter on {p['sides']}"
        )


def test_solution_words_are_in_the_runtime_dictionary(puzzles, dictionary):
    words_set, _ = dictionary
    for p in puzzles:
        for word in p["solution"]:
            assert word.lower() in words_set, (
                f"solution word {word!r} is missing from games/edgeways/words.json"
            )


def test_no_blocked_or_slur_terms_in_the_bank(puzzles):
    blocklist = {
        "nigger", "nigga", "spic", "chink", "kike", "faggot", "retard",
        "whore", "slut", "cunt", "coon", "gook", "tranny", "wetback", "dyke",
    }
    for p in puzzles:
        for word in p["solution"]:
            lowered = word.lower()
            assert not any(bad in lowered for bad in blocklist), word


def test_dictionary_file_is_well_formed(dictionary):
    words_set, words_list = dictionary
    assert len(words_list) > 50000
    assert len(words_list) == len(words_set), "dictionary contains duplicates"
    assert words_list == sorted(words_list), "dictionary is not sorted"
    for w in words_list[:2000]:
        assert w.isalpha()
        assert w == w.lower()
        assert len(w) >= 3


def test_dictionary_never_contains_a_word_that_could_never_be_played(dictionary):
    # Any word with two identical letters in a row can never satisfy the
    # no-same-side-twice rule, since a letter always sits on one side.
    _, words_list = dictionary
    offenders = [w for w in words_list if any(w[i] == w[i + 1] for i in range(len(w) - 1))]
    assert offenders == []


def test_par_two_puzzles_are_the_common_case(puzzles):
    # Not a hard requirement, but the bank should overwhelmingly favor the
    # two-word solutions the contract calls out as the intended craft.
    par_two = sum(1 for p in puzzles if p["par"] == 2)
    assert par_two / len(puzzles) >= 0.95


def test_no_single_solution_word_dominates_the_bank(puzzles):
    from collections import Counter

    counts = Counter()
    for p in puzzles:
        counts.update(p["solution"])
    worst_word, worst_count = counts.most_common(1)[0]
    assert worst_count <= 0.1 * len(puzzles), (
        f"{worst_word!r} appears in {worst_count} of {len(puzzles)} puzzles"
    )
