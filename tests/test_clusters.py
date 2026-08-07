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
MIN_BANK_SIZE = 120


@pytest.fixture(scope="module")
def bank():
    assert BANK_PATH.exists(), "data/clusters.json is missing; run tools/gen_clusters.py"
    return json.loads(BANK_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def puzzles(bank):
    return bank["puzzles"]


@pytest.fixture(scope="module")
def category_words_by_name():
    cats = gen.normalized_categories()
    by_name = {}
    for c in cats:
        by_name.setdefault(c["name"], set()).update(c["words"])
    return by_name


def test_bank_shape(bank):
    assert isinstance(bank, dict)
    assert "puzzles" in bank
    assert isinstance(bank["puzzles"], list)


def test_bank_meets_minimum_size(puzzles):
    assert len(puzzles) >= MIN_BANK_SIZE, (
        f"bank has {len(puzzles)} puzzles, contract requires >= {MIN_BANK_SIZE}"
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


def test_no_two_puzzles_are_identical(puzzles):
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


def test_known_fixed_categories_use_their_exact_word_set(puzzles):
    """Categories with exactly 4 candidate words should always appear as
    that exact set whenever they're used, a strong spot check on the four
    smallest, least ambiguous categories in the pool."""
    exact = {
        "Card suits": {"HEARTS", "CLUBS", "SPADES", "DIAMONDS"},
        "Cloud types": {"CUMULUS", "CIRRUS", "STRATUS", "NIMBUS"},
        "Seasons": {"SPRING", "SUMMER", "AUTUMN", "WINTER"},
    }
    found = {name: False for name in exact}
    for p in puzzles:
        for g in p["groups"]:
            if g["name"] in exact:
                assert set(g["words"]) == exact[g["name"]]
                found[g["name"]] = True
    assert all(found.values()), f"expected fixed categories never appeared: {found}"


def test_tier_distribution_uses_the_full_difficulty_ramp(puzzles):
    from collections import Counter

    counts = Counter(g["tier"] for p in puzzles for g in p["groups"])
    assert set(counts) == TIERS
    for tier in TIERS:
        assert counts[tier] == len(puzzles), f"tier {tier} should appear exactly once per puzzle"


def test_generator_reproduces_a_bank_of_equal_size(tmp_path):
    """The generator is deterministic: same seed, same output shape."""
    out = tmp_path / "clusters.json"
    puzzles = gen.generate(seed=810, count=150)
    gen.validate_bank(puzzles)
    assert len(puzzles) == 150
    again = gen.generate(seed=810, count=150)
    assert puzzles == again
