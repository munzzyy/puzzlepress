"""
Independent checks on the committed Edgeways bank and its runtime
dictionary. These re-derive every invariant from scratch rather than
calling back into tools/gen_edgeways.py, so a bug shared between the
generator and its own self-check can't slip through unnoticed.

The bank is three difficulty sections: {"easy": {...}, "medium": {...},
"hard": {...}}, each shaped like the v1 bank ({"puzzles": [...]}) so
pickDaily works unchanged against any one section.
"""
import json
from collections import Counter
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BANK_PATH = ROOT / "data" / "edgeways.json"
DICTIONARY_PATH = ROOT / "games" / "edgeways" / "words.json"

MIN_BANK_SIZE = 80
DIFFICULTIES = ("easy", "medium", "hard")
RARE_LETTERS = set("JQXZ")

BLOCKLIST = {
    "nigger", "nigga", "spic", "chink", "kike", "faggot", "retard",
    "whore", "slut", "cunt", "coon", "gook", "tranny", "wetback", "dyke",
}


@pytest.fixture(scope="module")
def bank():
    with open(BANK_PATH, encoding="utf-8") as f:
        return json.load(f)


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


def board_letters(puzzle):
    return set("".join(puzzle["sides"]))


def all_puzzles(bank):
    for diff in DIFFICULTIES:
        for p in bank[diff]["puzzles"]:
            yield diff, p


# ---------- bank shape ----------


def test_bank_file_exists_and_parses(bank):
    assert isinstance(bank, dict)
    assert set(bank.keys()) == set(DIFFICULTIES)


def test_each_section_preserves_the_v1_inner_shape(bank):
    for diff in DIFFICULTIES:
        section = bank[diff]
        assert isinstance(section, dict)
        assert set(section.keys()) == {"puzzles"}
        assert isinstance(section["puzzles"], list)


@pytest.mark.parametrize("diff", DIFFICULTIES)
def test_bank_meets_minimum_size_per_difficulty(bank, diff):
    puzzles = bank[diff]["puzzles"]
    assert len(puzzles) >= MIN_BANK_SIZE, (
        f"{diff} bank has {len(puzzles)} puzzles, contract requires >= {MIN_BANK_SIZE}"
    )


# ---------- per-puzzle shape, independent of difficulty ----------


def test_every_puzzle_has_the_right_shape(bank):
    for diff, p in all_puzzles(bank):
        assert set(p.keys()) == {"sides", "par", "solution"}, diff
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


def test_each_board_has_twelve_distinct_letters(bank):
    for diff, p in all_puzzles(bank):
        letters = "".join(p["sides"])
        assert len(letters) == 12
        assert len(set(letters)) == 12, f"{diff}: letters repeat across sides: {p['sides']}"


def test_no_duplicate_boards_within_a_difficulty(bank):
    for diff in DIFFICULTIES:
        boards = [tuple(sorted(p["sides"])) for p in bank[diff]["puzzles"]]
        assert len(boards) == len(set(boards)), f"{diff} bank contains duplicate boards"


def test_no_duplicate_boards_across_difficulties(bank):
    boards = [tuple(sorted(p["sides"])) for _, p in all_puzzles(bank)]
    assert len(boards) == len(set(boards)), "the same board ships under more than one difficulty"


def test_solution_words_are_at_least_three_letters(bank):
    for diff, p in all_puzzles(bank):
        for word in p["solution"]:
            assert len(word) >= 3, f"{diff}: solution word too short: {word}"
            assert word.isalpha()
            assert word == word.upper()


def test_solution_chain_rule_holds(bank):
    for diff, p in all_puzzles(bank):
        solution = p["solution"]
        for prev, nxt in zip(solution, solution[1:]):
            assert nxt[0] == prev[-1], (
                f"{diff}: chain broken between {prev!r} and {nxt!r} in {p['sides']}"
            )


def test_solution_never_jumps_to_the_same_side_twice_in_a_row(bank):
    for diff, p in all_puzzles(bank):
        side_of = side_of_map(p["sides"])
        for word in p["solution"]:
            for a, b in zip(word, word[1:]):
                assert a in side_of, f"{diff}: letter {a} not on board {p['sides']}"
                assert b in side_of, f"{diff}: letter {b} not on board {p['sides']}"
                assert side_of[a] != side_of[b], (
                    f"{diff}: {a}->{b} shares a side in word {word!r} on board {p['sides']}"
                )


def test_solution_uses_only_board_letters(bank):
    for diff, p in all_puzzles(bank):
        letters = board_letters(p)
        for word in p["solution"]:
            assert set(word) <= letters, (
                f"{diff}: word {word!r} uses a letter off the board {p['sides']}"
            )


def test_solution_covers_every_board_letter(bank):
    for diff, p in all_puzzles(bank):
        letters = board_letters(p)
        used = set("".join(p["solution"]))
        assert used == letters, (
            f"{diff}: solution {p['solution']} does not cover every letter on {p['sides']}"
        )


def test_solution_words_are_in_the_runtime_dictionary(bank, dictionary):
    words_set, _ = dictionary
    for diff, p in all_puzzles(bank):
        for word in p["solution"]:
            assert word.lower() in words_set, (
                f"{diff}: solution word {word!r} is missing from games/edgeways/words.json"
            )


def test_no_blocked_or_slur_terms_in_the_bank(bank):
    for diff, p in all_puzzles(bank):
        for word in p["solution"]:
            lowered = word.lower()
            assert not any(bad in lowered for bad in BLOCKLIST), f"{diff}: {word}"


# ---------- difficulty semantics ----------


def test_easy_puzzles_are_par_three(bank):
    for p in bank["easy"]["puzzles"]:
        assert p["par"] == 3
        assert len(p["solution"]) == 3


def test_easy_boards_use_only_common_letters(bank):
    for p in bank["easy"]["puzzles"]:
        offenders = board_letters(p) & RARE_LETTERS
        assert not offenders, f"easy board carries a rare letter {offenders}: {p['sides']}"


def test_medium_puzzles_are_par_two(bank):
    for p in bank["medium"]["puzzles"]:
        assert p["par"] == 2
        assert len(p["solution"]) == 2


def test_hard_puzzles_are_par_two(bank):
    for p in bank["hard"]["puzzles"]:
        assert p["par"] == 2
        assert len(p["solution"]) == 2


def test_hard_boards_always_carry_a_rare_letter(bank):
    for p in bank["hard"]["puzzles"]:
        offenders = board_letters(p) & RARE_LETTERS
        assert offenders, f"hard board is missing a J/Q/X/Z: {p['sides']}"


def test_hard_rare_letter_is_proven_by_the_committed_solution(bank):
    # rare_ok in the generator checks the board, but the board is derived
    # entirely from the committed solution letters, so this is really the
    # same guarantee re-proven from the solution side.
    for p in bank["hard"]["puzzles"]:
        solution_letters = set("".join(p["solution"]))
        assert solution_letters & RARE_LETTERS


# ---------- bank quality ----------


@pytest.mark.parametrize("diff", DIFFICULTIES)
def test_no_single_solution_word_dominates_a_difficulty(bank, diff):
    puzzles = bank[diff]["puzzles"]
    counts = Counter()
    for p in puzzles:
        counts.update(p["solution"])
    worst_word, worst_count = counts.most_common(1)[0]
    assert worst_count <= 0.1 * len(puzzles), (
        f"{diff}: {worst_word!r} appears in {worst_count} of {len(puzzles)} puzzles"
    )


# ---------- runtime dictionary ----------


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
