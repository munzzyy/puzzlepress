"""pytest suite for the committed Minigrid bank: data/minigrid.json.

Schema and invariant checks run directly against the committed file, so a
stale or hand-edited bank fails even if the generator itself is fine.
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


def test_bank_file_exists():
    assert os.path.isfile(BANK_PATH)


def test_bank_schema():
    bank = load_bank()
    assert isinstance(bank, dict)
    assert set(bank.keys()) == {"puzzles"}
    assert isinstance(bank["puzzles"], list)
    for p in bank["puzzles"]:
        assert set(p.keys()) == {"grid", "clues"}
        assert isinstance(p["grid"], list)
        assert isinstance(p["clues"], dict)
        assert set(p["clues"].keys()) == {"across", "down"}


def test_bank_meets_size_target_or_the_shortfall_is_documented():
    bank = load_bank()
    # Contract target is 60+. If this ever regresses below that, it must be
    # an intentional, documented shortfall (see the build's final report),
    # not a silent regression, so fail loud rather than skip quietly.
    assert len(bank["puzzles"]) >= 60, (
        f"bank has {len(bank['puzzles'])} puzzles; contract target is 60+. "
        "If a smaller bank is intentional, this test's threshold should be "
        "updated alongside a documented reason, not left to silently pass."
    )


def test_grids_are_5x5_of_uppercase_letters_or_blocks():
    bank = load_bank()
    for i, p in enumerate(bank["puzzles"]):
        grid = p["grid"]
        assert len(grid) == SIZE, f"puzzle {i}: wrong row count"
        for row in grid:
            assert len(row) == SIZE, f"puzzle {i}: wrong row length"
            for ch in row:
                assert ch == "#" or ("A" <= ch <= "Z"), f"puzzle {i}: bad char {ch!r}"


def test_grids_are_all_unique():
    bank = load_bank()
    sigs = [tuple(p["grid"]) for p in bank["puzzles"]]
    assert len(set(sigs)) == len(sigs), "duplicate grid found in bank"


def test_block_pattern_is_one_of_the_proven_valid_templates():
    bank = load_bank()
    valid = {blocks for variants in gen.TEMPLATES.values() for blocks in variants}
    for i, p in enumerate(bank["puzzles"]):
        blocks = frozenset(blocks_of(p["grid"]))
        assert blocks in valid, f"puzzle {i}: block set {blocks} is not a proven-valid template"


def test_every_entry_is_length_3_4_or_5_and_a_real_word():
    bank = load_bank()
    dictionary = load_wordlist_set()
    for i, p in enumerate(bank["puzzles"]):
        blocks = blocks_of(p["grid"])
        slots = gen.compute_slots(blocks)
        assert len(slots) > 0, f"puzzle {i}: no entries found"
        for s in slots:
            assert s["length"] in (3, 4, 5), f"puzzle {i}: entry length {s['length']}"
            word = "".join(p["grid"][r][c] for r, c in s["cells"])
            assert word.lower() in dictionary, f"puzzle {i}: {word!r} not in shared wordlist"


def test_no_word_is_reused_across_and_down_in_one_puzzle():
    # A repeated word would hand a player half of a second clue for free.
    bank = load_bank()
    for i, p in enumerate(bank["puzzles"]):
        blocks = blocks_of(p["grid"])
        slots = gen.compute_slots(blocks)
        words = [
            "".join(p["grid"][r][c] for r, c in s["cells"])
            for s in slots
        ]
        assert len(set(words)) == len(words), f"puzzle {i}: a word is used both across and down"


def test_clue_numbers_exactly_match_grid_derived_numbering():
    bank = load_bank()
    for i, p in enumerate(bank["puzzles"]):
        blocks = blocks_of(p["grid"])
        slots = gen.compute_slots(blocks)
        expected = {"across": set(), "down": set()}
        for s in slots:
            expected[s["dir"]].add(str(s["number"]))
        for direction in ("across", "down"):
            got = set(p["clues"][direction].keys())
            assert got == expected[direction], (
                f"puzzle {i} {direction}: clue numbers {got} != grid slots {expected[direction]}"
            )


def test_every_clue_matches_its_answer_via_the_curated_source():
    bank = load_bank()
    for i, p in enumerate(bank["puzzles"]):
        blocks = blocks_of(p["grid"])
        slots = gen.compute_slots(blocks)
        for s in slots:
            word = "".join(p["grid"][r][c] for r, c in s["cells"])
            clue_text = p["clues"][s["dir"]][str(s["number"])]
            assert word in gen.CLUES, f"puzzle {i}: {word!r} has no curated clue"
            assert clue_text == gen.CLUES[word], (
                f"puzzle {i}: clue for {word!r} does not match the curated text"
            )


def test_clue_text_is_clean_ascii_punctuation_no_dashes_or_ellipsis():
    bank = load_bank()
    forbidden = ("\u2014", "\u2013", "\u2026")  # em dash, en dash, ellipsis char
    for i, p in enumerate(bank["puzzles"]):
        for direction in ("across", "down"):
            for num, text in p["clues"][direction].items():
                assert text.strip() == text and text, f"puzzle {i} {direction} {num}: blank/padded clue"
                for bad in forbidden:
                    assert bad not in text, f"puzzle {i} {direction} {num}: forbidden character in {text!r}"


def test_all_grid_letters_come_from_the_curated_word_set():
    # Guards against ever reintroducing an unvetted fallback dictionary.
    bank = load_bank()
    for i, p in enumerate(bank["puzzles"]):
        blocks = blocks_of(p["grid"])
        slots = gen.compute_slots(blocks)
        for s in slots:
            word = "".join(p["grid"][r][c] for r, c in s["cells"])
            assert word in gen.CURATED_SET, f"puzzle {i}: {word!r} is not in the curated word set"


def test_spot_check_a_few_known_curated_words_have_sensible_clues():
    assert gen.CLUES["CAT"] == "Purring pet"
    assert gen.CLUES["OCEAN"] == "Vast body of saltwater"
    assert "SAT" not in gen.CLUES or gen.CLUES["SAT"]  # sanity: no empty clue text


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
                "--out", str(out),
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, result.stdout + result.stderr

    assert out_a.read_text(encoding="utf-8") == out_b.read_text(encoding="utf-8")


def test_generator_different_seeds_produce_different_small_banks(tmp_path):
    out_a = tmp_path / "a.json"
    out_b = tmp_path / "b.json"
    subprocess.run(
        [sys.executable, GEN_PATH, "--seed", "1", "--count", "5", "--cap-per-template", "20", "--out", str(out_a)],
        cwd=ROOT, check=True, capture_output=True, text=True, timeout=60,
    )
    subprocess.run(
        [sys.executable, GEN_PATH, "--seed", "2", "--count", "5", "--cap-per-template", "20", "--out", str(out_b)],
        cwd=ROOT, check=True, capture_output=True, text=True, timeout=60,
    )
    bank_a = json.loads(out_a.read_text(encoding="utf-8"))
    bank_b = json.loads(out_b.read_text(encoding="utf-8"))
    assert bank_a != bank_b
