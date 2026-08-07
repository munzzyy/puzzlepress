"""pytest suite for the committed Wordrow bank: data/wordrow.json.

Schema and invariant checks run directly against the committed file (so a
stale bank fails CI even if the generator itself is fine), plus a
determinism check that regenerating with the same seed reproduces it
exactly.
"""

import importlib.util
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK_PATH = os.path.join(ROOT, "data", "wordrow.json")
GEN_PATH = os.path.join(ROOT, "tools", "gen_wordrow.py")
WORDLIST_PATH = os.path.join(ROOT, "data", "wordlist.txt")
DEFAULT_SEED = 20260810


def _load_gen_module():
    spec = importlib.util.spec_from_file_location("gen_wordrow", GEN_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gen = _load_gen_module()


def load_bank():
    with open(BANK_PATH, encoding="utf-8") as f:
        return json.load(f)


def test_bank_file_exists():
    assert os.path.isfile(BANK_PATH)


def test_bank_schema():
    bank = load_bank()
    assert isinstance(bank, dict)
    assert set(bank.keys()) == {"answers", "allowed"}
    assert isinstance(bank["answers"], list)
    assert isinstance(bank["allowed"], list)


def test_answers_meets_bank_size_target():
    bank = load_bank()
    assert len(bank["answers"]) >= 500, "contract requires 500+ answers"


def test_answers_are_five_lowercase_letters():
    bank = load_bank()
    for w in bank["answers"]:
        assert isinstance(w, str)
        assert len(w) == 5
        assert w == w.lower()
        assert w.isalpha()


def test_answers_are_unique():
    bank = load_bank()
    assert len(set(bank["answers"])) == len(bank["answers"])


def test_answers_are_all_valid_guesses():
    bank = load_bank()
    allowed = set(bank["allowed"])
    missing = [w for w in bank["answers"] if w not in allowed]
    assert missing == [], f"answers missing from allowed: {missing}"


def test_allowed_is_sorted_unique_and_well_formed():
    bank = load_bank()
    allowed = bank["allowed"]
    assert allowed == sorted(allowed)
    assert len(set(allowed)) == len(allowed)
    for w in allowed:
        assert len(w) == 5
        assert w == w.lower()
        assert w.isalpha()


def test_allowed_is_a_large_dictionary():
    bank = load_bank()
    # A real "full guess dictionary" should dwarf the curated answer pool.
    assert len(bank["allowed"]) >= 3000


def test_no_simple_plural_answers():
    _, all_words = gen.load_wordlist(WORDLIST_PATH)
    bank = load_bank()
    plurals = [w for w in bank["answers"] if gen.is_simple_plural(w, all_words)]
    assert plurals == [], f"answers should not include plain plurals: {plurals}"


def test_no_blocklisted_words_in_either_list():
    bank = load_bank()
    hit_answers = set(bank["answers"]) & gen.PROFANITY_BLOCKLIST
    hit_allowed = set(bank["allowed"]) & gen.PROFANITY_BLOCKLIST
    assert hit_answers == set()
    assert hit_allowed == set()


def test_spot_check_common_words_present_as_answers():
    bank = load_bank()
    answers = set(bank["answers"])
    for w in ["house", "world", "about", "light", "water", "music"]:
        assert w in answers, f"expected common word {w!r} in answers"


def test_generator_validate_reports_clean_committed_bank():
    bank = load_bank()
    _, all_words = gen.load_wordlist(WORDLIST_PATH)
    errors = gen.validate(bank, all_words)
    assert errors == []


def test_generator_is_deterministic_for_the_committed_seed(tmp_path):
    out = tmp_path / "wordrow_regen.json"
    result = subprocess.run(
        [sys.executable, GEN_PATH, "--seed", str(DEFAULT_SEED), "--out", str(out)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr

    regenerated = json.loads(out.read_text(encoding="utf-8"))
    committed = load_bank()
    assert regenerated == committed


def test_generator_is_deterministic_across_two_runs_same_seed(tmp_path):
    out_a = tmp_path / "a.json"
    out_b = tmp_path / "b.json"
    for out in (out_a, out_b):
        result = subprocess.run(
            [sys.executable, GEN_PATH, "--seed", "42", "--out", str(out)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stdout + result.stderr

    assert out_a.read_text(encoding="utf-8") == out_b.read_text(encoding="utf-8")


def test_generator_different_seeds_reorder_answers(tmp_path):
    out_a = tmp_path / "a.json"
    out_b = tmp_path / "b.json"
    subprocess.run(
        [sys.executable, GEN_PATH, "--seed", "1", "--out", str(out_a)],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    subprocess.run(
        [sys.executable, GEN_PATH, "--seed", "2", "--out", str(out_b)],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    bank_a = json.loads(out_a.read_text(encoding="utf-8"))
    bank_b = json.loads(out_b.read_text(encoding="utf-8"))
    assert bank_a["answers"] != bank_b["answers"]
    assert set(bank_a["answers"]) == set(bank_b["answers"])
