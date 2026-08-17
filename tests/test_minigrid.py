"""pytest suite for the committed Minigrid bank: data/minigrid.json.

Schema and invariant checks run directly against the committed file, so a
stale or hand-edited bank fails even if the generator itself is fine.

v2 bank shape: {"easy": {"puzzles": [...]}, "medium": {...}, "hard": {...}}.
Medium is the original v1 vocabulary and clue style, regraded under its own
key. Easy is the subset of that vocabulary whose clues are single, straight
definitions. Hard is generated from the same vocabulary (the crossing search
needs the full ~2200-word pool to find fillings at all -- see gen_minigrid's
module comments) and then selected for having entries with a trickier sense,
re-clued with HARD_CLUE_OVERRIDES wherever one exists.
"""

import importlib.util
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK_PATH = os.path.join(ROOT, "data", "minigrid.json")
GEN_PATH = os.path.join(ROOT, "tools", "gen_minigrid.py")
WORDLIST_PATH = os.path.join(ROOT, "data", "wordlist.txt")
DEFAULT_SEED = 20260810
SIZE = 5
TIERS = ("easy", "medium", "hard")
# Contract minimum is 40 per difficulty. If a tier ever regresses below
# this, it must be an intentional, documented shortfall, not a silent
# regression, so fail loud rather than skip quietly.
MIN_PER_TIER = 40


def _load_gen_module():
    spec = importlib.util.spec_from_file_location("gen_minigrid", GEN_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gen = _load_gen_module()


def load_bank():
    with open(BANK_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_wordlist_set():
    with open(WORDLIST_PATH, encoding="utf-8") as f:
        return {line.strip().lower() for line in f if line.strip()}


def blocks_of(grid):
    return {(r, c) for r in range(SIZE) for c in range(SIZE) if grid[r][c] == "#"}


def all_puzzles(bank):
    """(tier, index, puzzle) for every puzzle in every tier."""
    for tier in TIERS:
        for i, p in enumerate(bank[tier]["puzzles"]):
            yield tier, i, p


def hard_clue_lookup(word):
    return gen.HARD_CLUE_OVERRIDES.get(word, gen.CLUES[word])


CLUE_LOOKUP = {"easy": lambda w: gen.CLUES[w], "medium": lambda w: gen.CLUES[w], "hard": hard_clue_lookup}


def test_bank_file_exists():
    assert os.path.isfile(BANK_PATH)


def test_bank_schema():
    bank = load_bank()
    assert isinstance(bank, dict)
    assert set(bank.keys()) == set(TIERS)
    for tier in TIERS:
        assert isinstance(bank[tier], dict)
        assert set(bank[tier].keys()) == {"puzzles"}
        assert isinstance(bank[tier]["puzzles"], list)
        for p in bank[tier]["puzzles"]:
            assert set(p.keys()) == {"grid", "clues"}
            assert isinstance(p["grid"], list)
            assert isinstance(p["clues"], dict)
            assert set(p["clues"].keys()) == {"across", "down"}


def test_every_tier_meets_size_target_or_the_shortfall_is_documented():
    bank = load_bank()
    for tier in TIERS:
        n = len(bank[tier]["puzzles"])
        assert n >= MIN_PER_TIER, (
            f"{tier} bank has {n} puzzles; contract minimum is {MIN_PER_TIER}. "
            "If a smaller bank is intentional, this test's threshold should be "
            "updated alongside a documented reason, not left to silently pass."
        )


def test_grids_are_5x5_of_uppercase_letters_or_blocks():
    bank = load_bank()
    for tier, i, p in all_puzzles(bank):
        grid = p["grid"]
        assert len(grid) == SIZE, f"{tier} puzzle {i}: wrong row count"
        for row in grid:
            assert len(row) == SIZE, f"{tier} puzzle {i}: wrong row length"
            for ch in row:
                assert ch == "#" or ("A" <= ch <= "Z"), f"{tier} puzzle {i}: bad char {ch!r}"


def test_grids_are_all_unique_within_each_tier():
    bank = load_bank()
    for tier in TIERS:
        sigs = [tuple(p["grid"]) for p in bank[tier]["puzzles"]]
        assert len(set(sigs)) == len(sigs), f"{tier}: duplicate grid found in bank"


def test_no_puzzle_grid_is_shared_across_two_difficulties():
    # Each tier's daily rotation should be its own content, not a relabeled
    # copy of another tier's. The generator enforces this at build time by
    # construction (a shared "used" set spans all three tiers); this locks
    # the resulting bank to that guarantee.
    bank = load_bank()
    grids_by_tier = {tier: {tuple(p["grid"]) for p in bank[tier]["puzzles"]} for tier in TIERS}
    assert grids_by_tier["easy"].isdisjoint(grids_by_tier["medium"])
    assert grids_by_tier["easy"].isdisjoint(grids_by_tier["hard"])
    assert grids_by_tier["medium"].isdisjoint(grids_by_tier["hard"])


def test_block_pattern_is_one_of_the_proven_valid_templates():
    bank = load_bank()
    valid = {blocks for variants in gen.TEMPLATES.values() for blocks in variants}
    for tier, i, p in all_puzzles(bank):
        blocks = frozenset(blocks_of(p["grid"]))
        assert blocks in valid, f"{tier} puzzle {i}: block set {blocks} is not a proven-valid template"


def test_every_entry_is_length_3_4_or_5_and_a_real_word():
    bank = load_bank()
    dictionary = load_wordlist_set()
    for tier, i, p in all_puzzles(bank):
        blocks = blocks_of(p["grid"])
        slots = gen.compute_slots(blocks)
        assert len(slots) > 0, f"{tier} puzzle {i}: no entries found"
        for s in slots:
            assert s["length"] in (3, 4, 5), f"{tier} puzzle {i}: entry length {s['length']}"
            word = "".join(p["grid"][r][c] for r, c in s["cells"])
            assert word.lower() in dictionary, f"{tier} puzzle {i}: {word!r} not in shared wordlist"


def test_no_word_is_reused_across_and_down_in_one_puzzle():
    # A repeated word would hand a player half of a second clue for free.
    bank = load_bank()
    for tier, i, p in all_puzzles(bank):
        blocks = blocks_of(p["grid"])
        slots = gen.compute_slots(blocks)
        words = ["".join(p["grid"][r][c] for r, c in s["cells"]) for s in slots]
        assert len(set(words)) == len(words), f"{tier} puzzle {i}: a word is used both across and down"


def test_clue_numbers_exactly_match_grid_derived_numbering():
    bank = load_bank()
    for tier, i, p in all_puzzles(bank):
        blocks = blocks_of(p["grid"])
        slots = gen.compute_slots(blocks)
        expected = {"across": set(), "down": set()}
        for s in slots:
            expected[s["dir"]].add(str(s["number"]))
        for direction in ("across", "down"):
            got = set(p["clues"][direction].keys())
            assert got == expected[direction], (
                f"{tier} puzzle {i} {direction}: clue numbers {got} != grid slots {expected[direction]}"
            )


def test_every_clue_matches_its_tiers_expected_source():
    bank = load_bank()
    for tier, i, p in all_puzzles(bank):
        blocks = blocks_of(p["grid"])
        slots = gen.compute_slots(blocks)
        lookup = CLUE_LOOKUP[tier]
        for s in slots:
            word = "".join(p["grid"][r][c] for r, c in s["cells"])
            clue_text = p["clues"][s["dir"]][str(s["number"])]
            assert word in gen.CLUES, f"{tier} puzzle {i}: {word!r} has no curated clue"
            assert clue_text == lookup(word), f"{tier} puzzle {i}: clue for {word!r} does not match its tier's source"


def test_easy_tier_is_entirely_straight_definition_clues():
    bank = load_bank()
    for i, p in enumerate(bank["easy"]["puzzles"]):
        blocks = blocks_of(p["grid"])
        for s in gen.compute_slots(blocks):
            word = "".join(p["grid"][r][c] for r, c in s["cells"])
            assert not gen.has_dual_sense(word), f"easy puzzle {i}: {word!r} carries a trickier sense"


def test_hard_tier_puzzles_each_have_at_least_one_trickier_entry():
    bank = load_bank()
    for i, p in enumerate(bank["hard"]["puzzles"]):
        blocks = blocks_of(p["grid"])
        words = ["".join(p["grid"][r][c] for r, c in s["cells"]) for s in gen.compute_slots(blocks)]
        tricky = sum(1 for w in words if gen.has_dual_sense(w))
        assert tricky >= 1, f"hard puzzle {i}: no entry carries a trickier sense"


def test_clue_text_is_clean_ascii_punctuation_no_dashes_or_ellipsis():
    bank = load_bank()
    forbidden = ("\u2014", "\u2013", "\u2026")  # em dash, en dash, ellipsis char
    for tier, i, p in all_puzzles(bank):
        for direction in ("across", "down"):
            for num, text in p["clues"][direction].items():
                assert text.strip() == text and text, f"{tier} puzzle {i} {direction} {num}: blank/padded clue"
                for bad in forbidden:
                    assert bad not in text, f"{tier} puzzle {i} {direction} {num}: forbidden character in {text!r}"


def test_all_grid_letters_come_from_the_curated_word_set():
    # Guards against ever reintroducing an unvetted fallback dictionary.
    bank = load_bank()
    for tier, i, p in all_puzzles(bank):
        blocks = blocks_of(p["grid"])
        slots = gen.compute_slots(blocks)
        for s in slots:
            word = "".join(p["grid"][r][c] for r, c in s["cells"])
            assert word in gen.CURATED_SET, f"{tier} puzzle {i}: {word!r} is not in the curated word set"


def test_hard_overrides_are_a_subset_of_the_curated_vocabulary():
    assert set(gen.HARD_CLUE_OVERRIDES).issubset(gen.CURATED_SET)


def test_spot_check_a_few_known_curated_words_have_sensible_clues():
    assert gen.CLUES["CAT"] == "Purring pet"
    assert gen.CLUES["OCEAN"] == "Vast body of saltwater"
    assert "SAT" not in gen.CLUES or gen.CLUES["SAT"]  # sanity: no empty clue text


def test_spot_check_a_hard_override_reads_differently_from_its_medium_clue():
    assert gen.HARD_CLUE_OVERRIDES["SAW"] != gen.CLUES["SAW"]
    assert gen.HARD_CLUE_OVERRIDES["SAW"] and gen.CLUES["SAW"]


def test_generator_is_deterministic_for_a_small_run(tmp_path):
    out_a = tmp_path / "a.json"
    out_b = tmp_path / "b.json"
    for out in (out_a, out_b):
        result = subprocess.run(
            [
                sys.executable, GEN_PATH,
                "--seed", str(DEFAULT_SEED),
                "--count", "5",
                "--cap-per-template", "20",
                # Bound the search by nodes, not by wall clock. The node budget
                # is deterministic, so both runs stop in the same place on any
                # machine; a time budget that actually fires would let a slow
                # runner search less than a fast one and the seed would stop
                # meaning anything. Keep the time budget only as a hang guard,
                # far enough out that it never binds, and assert below that it
                # did not fire.
                "--node-budget", "150000",
                "--time-budget", "600",
                "--out", str(out),
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=240,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        assert "NOT reproducible" not in result.stderr, (
            "the time budget cut the search short, so this run was never "
            "reproducible in the first place:\n" + result.stderr
        )

    assert out_a.read_text(encoding="utf-8") == out_b.read_text(encoding="utf-8")


def test_generator_different_seeds_produce_different_small_banks(tmp_path):
    out_a = tmp_path / "a.json"
    out_b = tmp_path / "b.json"
    subprocess.run(
        [
            sys.executable, GEN_PATH, "--seed", "1", "--count", "5",
            "--cap-per-template", "20", "--time-budget", "8", "--out", str(out_a),
        ],
        cwd=ROOT, check=True, capture_output=True, text=True, timeout=90,
    )
    subprocess.run(
        [
            sys.executable, GEN_PATH, "--seed", "2", "--count", "5",
            "--cap-per-template", "20", "--time-budget", "8", "--out", str(out_b),
        ],
        cwd=ROOT, check=True, capture_output=True, text=True, timeout=90,
    )
    bank_a = json.loads(out_a.read_text(encoding="utf-8"))
    bank_b = json.loads(out_b.read_text(encoding="utf-8"))
    assert bank_a != bank_b


def test_generator_small_run_bank_still_has_all_three_tiers(tmp_path):
    out = tmp_path / "small.json"
    subprocess.run(
        [
            sys.executable, GEN_PATH, "--seed", str(DEFAULT_SEED), "--count", "5",
            "--cap-per-template", "20",
            # Same reason as the determinism test: whether a tier comes out
            # empty must not depend on how fast the machine is.
            "--node-budget", "150000", "--time-budget", "600", "--out", str(out),
        ],
        cwd=ROOT, check=True, capture_output=True, text=True, timeout=240,
    )
    small_bank = json.loads(out.read_text(encoding="utf-8"))
    assert set(small_bank.keys()) == set(TIERS)
    for tier in TIERS:
        assert len(small_bank[tier]["puzzles"]) > 0, f"small run produced no {tier} puzzles"
