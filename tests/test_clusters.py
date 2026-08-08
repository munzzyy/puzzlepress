"""Schema and invariant tests for the committed Clusters bank.

Run: pytest tests/test_clusters.py
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BANK_PATH = ROOT / "data" / "clusters.json"

sys.path.insert(0, str(ROOT / "tools"))
import gen_clusters as gen  # noqa: E402

TIERS = set(gen.TIERS)
DIFFICULTIES = gen.DIFFICULTIES
MIN_BANK_SIZE = gen.MIN_BANK_SIZE


@pytest.fixture(scope="module")
def bank():
    assert BANK_PATH.exists(), "data/clusters.json is missing; run tools/gen_clusters.py"
    return json.loads(BANK_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def category_words_by_name():
    cats = gen.normalized_categories()
    by_name = {}
    for c in cats:
        by_name.setdefault(c["name"], set()).update(c["words"])
    return by_name


@pytest.fixture(scope="module", params=list(DIFFICULTIES))
def diff(request):
    return request.param


@pytest.fixture
def puzzles(bank, diff):
    return bank[diff]["puzzles"]


def test_bank_has_all_three_difficulty_sections(bank):
    assert set(bank) == set(DIFFICULTIES)
    for d in DIFFICULTIES:
        assert isinstance(bank[d], dict)
        assert isinstance(bank[d]["puzzles"], list)


def test_bank_meets_minimum_size(puzzles, diff):
    assert len(puzzles) >= MIN_BANK_SIZE, (
        f"{diff} bank has {len(puzzles)} puzzles, contract requires >= {MIN_BANK_SIZE}"
    )


def test_every_puzzle_has_four_groups_one_per_tier(puzzles):
    for i, p in enumerate(puzzles):
        groups = p["groups"]
        assert len(groups) == 4, f"puzzle {i} has {len(groups)} groups"
        tiers = [g["tier"] for g in groups]
        assert set(tiers) == TIERS, f"puzzle {i} tier set is {tiers}"
        assert len(set(tiers)) == 4, f"puzzle {i} repeats a tier"


def test_every_group_has_four_unique_uppercase_words(puzzles):
    for i, p in enumerate(puzzles):
        for g in p["groups"]:
            words = g["words"]
            assert len(words) == 4, f"puzzle {i} group {g['name']!r} has {len(words)} words"
            assert len(set(words)) == 4, f"puzzle {i} group {g['name']!r} has a repeated word"
            for w in words:
                assert isinstance(w, str) and w.isalpha() and w.isupper(), (
                    f"puzzle {i} group {g['name']!r} has malformed word {w!r}"
                )


def test_every_puzzle_has_sixteen_unique_words(puzzles):
    for i, p in enumerate(puzzles):
        all_words = [w for g in p["groups"] for w in g["words"]]
        assert len(all_words) == 16, f"puzzle {i} has {len(all_words)} tiles"
        assert len(set(all_words)) == 16, f"puzzle {i} has a word repeated across groups"


def test_no_puzzle_uses_a_reserved_tier_word(puzzles):
    for i, p in enumerate(puzzles):
        for g in p["groups"]:
            for w in g["words"]:
                assert w not in gen.RESERVED_WORDS, (
                    f"puzzle {i} group {g['name']!r} uses reserved tier word {w!r}"
                )


def test_no_two_puzzles_in_the_same_section_are_identical(puzzles):
    seen = set()
    for i, p in enumerate(puzzles):
        key = frozenset(w for g in p["groups"] for w in g["words"])
        assert key not in seen, f"puzzle {i} duplicates an earlier puzzle's word set"
        seen.add(key)


def test_group_names_are_non_empty_and_distinct_within_a_puzzle(puzzles):
    for i, p in enumerate(puzzles):
        names = [g["name"] for g in p["groups"]]
        assert all(isinstance(n, str) and n.strip() for n in names), f"puzzle {i} has a blank name"
        assert len(set(names)) == 4, f"puzzle {i} repeats a category name"


def test_group_words_actually_belong_to_their_named_category(puzzles, category_words_by_name):
    """Spot-check: every answer word is a genuine member of the category pool
    it claims to belong to, i.e. the clue (category name) matches the answer."""
    for i, p in enumerate(puzzles):
        for g in p["groups"]:
            valid = category_words_by_name.get(g["name"])
            assert valid is not None, f"puzzle {i} references unknown category {g['name']!r}"
            for w in g["words"]:
                assert w in valid, (
                    f"puzzle {i}: {w!r} is not a candidate word for category {g['name']!r}"
                )


def test_tier_distribution_uses_the_full_difficulty_ramp(puzzles):
    from collections import Counter

    counts = Counter(g["tier"] for p in puzzles for g in p["groups"])
    assert set(counts) == TIERS
    for tier in TIERS:
        assert counts[tier] == len(puzzles), f"tier {tier} should appear exactly once per puzzle"


def test_no_puzzle_word_set_is_reused_across_difficulty_sections(bank):
    seen = {}
    for d in DIFFICULTIES:
        for i, p in enumerate(bank[d]["puzzles"]):
            key = frozenset(w for g in p["groups"] for w in g["words"])
            assert key not in seen, (
                f"{d} puzzle {i} duplicates {seen.get(key)}'s word set"
            )
            seen[key] = f"{d}[{i}]"


def test_easy_puzzles_have_zero_cross_group_decoys(bank, category_words_by_name):
    by_name = {c["name"]: c for c in gen.normalized_categories()}
    for i, p in enumerate(bank["easy"]["puzzles"]):
        decoys, _trap = gen.decoy_score(p["groups"], by_name)
        assert decoys == 0, f"easy puzzle {i} has {decoys} cross-group decoys, expected 0"


def test_hard_puzzles_have_decoy_pressure_and_a_trap_pairing(bank):
    by_name = {c["name"]: c for c in gen.normalized_categories()}
    for i, p in enumerate(bank["hard"]["puzzles"]):
        decoys, trap = gen.decoy_score(p["groups"], by_name)
        assert decoys >= 2, f"hard puzzle {i} has {decoys} decoys, contract requires >= 2"
        assert trap, f"hard puzzle {i} has no trap pairing (two groups that decoy each other)"


def test_medium_is_the_ungraded_middle_ground(bank):
    """Medium isn't required to hit any decoy threshold, but every puzzle in
    it still has to be a real, valid puzzle (covered by the shared checks
    above run against the medium fixture)."""
    assert len(bank["medium"]["puzzles"]) >= MIN_BANK_SIZE


def test_decoy_score_detects_a_known_trap_pairing():
    """Unit check on the scorer itself, independent of the shipped bank:
    two categories that both draw from an overlapping word plausibly trap
    each other, and a completely disjoint pair does not."""
    by_name = {c["name"]: c for c in gen.normalized_categories()}
    weather = by_name["Types of weather"]  # RAIN, SNOW, WIND, FOG, HAIL, SLEET
    before_storm = by_name["Words that precede STORM"]  # ..., SNOW, ..., RAIN

    groups = [
        {"name": weather["name"], "words": ["RAIN", "FOG", "HAIL", "SLEET"]},
        {"name": before_storm["name"], "words": ["BRAIN", "THUNDER", "DUST", "FIRE"]},
    ]
    decoys, trap = gen.decoy_score(groups, by_name)
    # RAIN (weather) is also a before_storm candidate: a one-way decoy, not
    # yet a trap (none of before_storm's actual picks are weather candidates).
    assert decoys == 1
    assert trap is False

    groups_with_swap_back = [
        {"name": weather["name"], "words": ["RAIN", "FOG", "HAIL", "SLEET"]},
        {"name": before_storm["name"], "words": ["SNOW", "THUNDER", "DUST", "FIRE"]},
    ]
    decoys2, trap2 = gen.decoy_score(groups_with_swap_back, by_name)
    assert decoys2 == 2
    assert trap2 is True

    disjoint = [
        {"name": "Card suits", "words": ["HEARTS", "CLUBS", "SPADES", "DIAMONDS"]},
        {"name": "Seasons", "words": ["SPRING", "SUMMER", "AUTUMN", "WINTER"]},
    ]
    decoys3, trap3 = gen.decoy_score(disjoint, by_name)
    assert decoys3 == 0
    assert trap3 is False


def test_generate_bank_reproduces_an_equal_shape_deterministically():
    """The generator is deterministic: same seed, same output shape."""
    buckets = gen.generate_bank(seed=810, per_diff=100)
    bank = {d: {"puzzles": buckets[d]} for d in DIFFICULTIES}
    gen.validate_difficulty_bank(bank)
    for d in DIFFICULTIES:
        assert len(buckets[d]) == 100

    again = gen.generate_bank(seed=810, per_diff=100)
    for d in DIFFICULTIES:
        assert buckets[d] == again[d]
