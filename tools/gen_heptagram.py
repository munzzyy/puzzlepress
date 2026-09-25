#!/usr/bin/env python3
"""
Deterministic generator for the Heptagram puzzle bank.

For each puzzle we pick 7 unique letters, a center letter that must appear
in every answer, and the exact set of dictionary words (>= 4 letters, built
only from those 7 letters) that count as valid answers. Every puzzle carries
at least one pangram (a word using all 7 letters).

The bank ships three separate sections, one per difficulty, each with its
own word-count band and its own relationship between the pangram and the
Master rank (WIN_PCT below mirrors RANKS' Master threshold in
games/heptagram/core.js -- keep the two in sync):

  easy:   20-30 words, no rare letter (J/Q/X/Z) in the seven, and Master is
          reachable WITHOUT ever finding the pangram (every non-pangram word,
          found together, already clears WIN_PCT of maxScore).
  medium: 20-60 words, the v1 generation behavior, unchanged.
  hard:   20-60 words with either 40+ words or a rare letter (J/Q/X/Z) among
          the seven, AND Master is NOT reachable without the pangram (every
          non-pangram word together still falls short of WIN_PCT).

A letter set is used by at most one difficulty, so no two difficulties ever
show the same wheel.

Usage:
    python3 tools/gen_heptagram.py --seed 7
    python3 tools/gen_heptagram.py --seed 7 --out data/heptagram.json
"""

import argparse
import json
import random
import sys
from pathlib import Path

from blocklist import BLOCKED_WORDS

ROOT = Path(__file__).resolve().parent.parent
WORDLIST_PATH = ROOT / "data" / "wordlist.txt"
DEFAULT_OUT = ROOT / "data" / "heptagram.json"

MIN_WORD_LEN = 4
MAX_WORD_LEN = 8
PANGRAM_BONUS = 7

# Keep this equal to the Master rank's pct in games/heptagram/core.js RANKS.
WIN_PCT = 0.7
RARE_LETTERS = set("jqxz")
HARD_WORD_COUNT_FLOOR = 40

DIFF_PARAMS = {
    "easy": {"min_words": 20, "max_words": 30},
    "medium": {"min_words": 20, "max_words": 60},
    "hard": {"min_words": 20, "max_words": 60},
}
DIFF_TARGETS = {"easy": 150, "medium": 200, "hard": 150}
MIN_ACCEPTABLE_BANK = 100


def load_wordlist(path):
    words = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            w = line.strip().lower()
            if w and w.isalpha() and len(w) >= MIN_WORD_LEN and w not in BLOCKED_WORDS:
                words.append(w)
    return words


def mask_of(word):
    m = 0
    for ch in word:
        m |= 1 << (ord(ch) - ord("a"))
    return m


def popcount(m):
    return bin(m).count("1")


def word_score(word, letters_mask):
    length = len(word)
    base = 1 if length == 4 else length
    return base + (PANGRAM_BONUS if is_pangram(word, letters_mask) else 0)


def is_pangram(word, letters_mask):
    return (mask_of(word) & letters_mask) == letters_mask


def build_mask_index(words):
    """word letters-mask -> list of distinct words with that exact mask.
    Only keeps words whose distinct-letter count is <= 7, since anything
    with more can never be a valid Heptagram answer."""
    index = {}
    for w in words:
        m = mask_of(w)
        if popcount(m) > 7:
            continue
        index.setdefault(m, []).append(w)
    return index


def subsets_of(mask):
    sub = mask
    while True:
        yield sub
        if sub == 0:
            break
        sub = (sub - 1) & mask


def words_for_mask(mask_index, letters_mask):
    seen = set()
    for sub in subsets_of(letters_mask):
        for w in mask_index.get(sub, ()):
            seen.add(w)
    return seen


def letters_string(mask):
    return "".join(chr(ord("a") + i) for i in range(26) if mask & (1 << i))


def select_words(subset, letters_mask, min_words, max_words):
    """Shapes an answer set into the [min_words, max_words] range. Every
    pangram is kept regardless of length (a puzzle needs at least one).
    Ordinary words longer than MAX_WORD_LEN are dropped first, then, if
    still oversized, shorter words are preferred (they skew more common
    in everyday vocabulary). Returns None if it can't reach min_words."""
    pangrams = [w for w in subset if is_pangram(w, letters_mask)]
    rest = [w for w in subset if w not in pangrams and len(w) <= MAX_WORD_LEN]

    if len(pangrams) > max_words:
        return None
    if len(pangrams) + len(rest) < min_words:
        return None
    if len(pangrams) + len(rest) <= max_words:
        return sorted(pangrams + rest)

    rest.sort(key=lambda w: (len(w), w))
    room = max_words - len(pangrams)
    return sorted(pangrams + rest[:room])


def non_pangram_score(words, letters_mask):
    return sum(word_score(w, letters_mask) for w in words if not is_pangram(w, letters_mask))


def meets_difficulty(difficulty, letters, words, letters_mask, max_score):
    has_rare = any(ch in RARE_LETTERS for ch in letters.lower())
    win_without_pangram = non_pangram_score(words, letters_mask) >= WIN_PCT * max_score

    if difficulty == "easy":
        return not has_rare and win_without_pangram
    if difficulty == "hard":
        return (len(words) >= HARD_WORD_COUNT_FLOOR or has_rare) and not win_without_pangram
    return True  # medium: v1 behavior, no extra constraint


def build_puzzle_for_difficulty(letters_mask, mask_index, rng, difficulty):
    params = DIFF_PARAMS[difficulty]
    candidate_words = words_for_mask(mask_index, letters_mask)
    letters = letters_string(letters_mask)

    valid_centers = {}
    for center in letters:
        subset = [w for w in candidate_words if center in w]
        words = select_words(subset, letters_mask, params["min_words"], params["max_words"])
        if words is None:
            continue
        max_score = sum(word_score(w, letters_mask) for w in words)
        if meets_difficulty(difficulty, letters, words, letters_mask, max_score):
            valid_centers[center] = (words, max_score)

    if not valid_centers:
        return None

    center = rng.choice(sorted(valid_centers))
    words, max_score = valid_centers[center]

    return {
        "letters": letters.upper(),
        "center": center.upper(),
        "words": words,
        "maxScore": max_score,
    }


def generate_section(candidate_masks, mask_index, rng, difficulty, target, seen_letters):
    puzzles = []
    for mask in candidate_masks:
        if len(puzzles) >= target:
            break
        letters_upper = letters_string(mask).upper()
        if letters_upper in seen_letters:
            continue
        puzzle = build_puzzle_for_difficulty(mask, mask_index, rng, difficulty)
        if puzzle is None:
            continue
        seen_letters.add(puzzle["letters"])
        puzzles.append(puzzle)

    puzzles.sort(key=lambda p: (p["letters"], p["center"]))
    return puzzles


def generate(seed, targets=DIFF_TARGETS):
    words = load_wordlist(WORDLIST_PATH)
    mask_index = build_mask_index(words)

    candidate_masks = sorted({m for m in mask_index if popcount(m) == 7}, key=letters_string)

    rng = random.Random(seed)
    rng.shuffle(candidate_masks)

    seen_letters = set()
    sections = {}
    # Hardest-to-satisfy sections first so plentiful, unconstrained "medium"
    # doesn't claim letter sets the pickier sections need.
    for difficulty in ("hard", "easy", "medium"):
        puzzles = generate_section(
            candidate_masks, mask_index, rng, difficulty, targets[difficulty], seen_letters
        )
        sections[difficulty] = {"puzzles": puzzles}
    return {d: sections[d] for d in ("easy", "medium", "hard")}


def validate_section(difficulty, puzzles):
    """Hard-validates one difficulty section. Raises on any violation."""
    if len(puzzles) == 0:
        raise ValueError(f"{difficulty}: bank is empty")

    params = DIFF_PARAMS[difficulty]
    seen_letters = set()
    for i, p in enumerate(puzzles):
        letters = p["letters"]
        center = p["center"]
        words = p["words"]

        if not isinstance(letters, str) or len(letters) != 7:
            raise ValueError(f"{difficulty} {i}: letters must be a 7-char string, got {letters!r}")
        if len(set(letters)) != 7:
            raise ValueError(f"{difficulty} {i}: letters must be 7 unique characters, got {letters!r}")
        if letters != letters.upper() or not letters.isalpha():
            raise ValueError(f"{difficulty} {i}: letters must be uppercase A-Z, got {letters!r}")
        if letters in seen_letters:
            raise ValueError(f"{difficulty} {i}: duplicate letter set {letters!r}")
        seen_letters.add(letters)

        if not isinstance(center, str) or len(center) != 1 or center not in letters:
            raise ValueError(f"{difficulty} {i}: center {center!r} must be one of letters {letters!r}")

        if not (params["min_words"] <= len(words) <= params["max_words"]):
            raise ValueError(
                f"{difficulty} {i}: word count {len(words)} outside "
                f"[{params['min_words']}, {params['max_words']}]"
            )
        if words != sorted(words):
            raise ValueError(f"{difficulty} {i}: words must be sorted")
        if len(words) != len(set(words)):
            raise ValueError(f"{difficulty} {i}: duplicate words in list")

        letters_mask = mask_of(letters.lower())
        found_pangram = False
        computed_score = 0
        for w in words:
            if len(w) < MIN_WORD_LEN:
                raise ValueError(f"{difficulty} {i}: word {w!r} shorter than {MIN_WORD_LEN}")
            if center.lower() not in w:
                raise ValueError(f"{difficulty} {i}: word {w!r} missing center {center!r}")
            wm = mask_of(w)
            if wm & ~letters_mask:
                raise ValueError(f"{difficulty} {i}: word {w!r} uses letters outside {letters!r}")
            if is_pangram(w, letters_mask):
                found_pangram = True
            computed_score += word_score(w, letters_mask)

        if not found_pangram:
            raise ValueError(f"{difficulty} {i}: no pangram among words for letters {letters!r}")
        if computed_score != p["maxScore"]:
            raise ValueError(
                f"{difficulty} {i}: maxScore mismatch, stored {p['maxScore']} computed {computed_score}"
            )

        if not meets_difficulty(difficulty, letters, words, letters_mask, p["maxScore"]):
            raise ValueError(f"{difficulty} {i}: letters {letters!r} fails its own difficulty rule")


def validate(bank):
    if set(bank.keys()) != set(DIFF_PARAMS.keys()):
        raise ValueError(f"bank must have exactly the sections {sorted(DIFF_PARAMS)}, got {sorted(bank)}")

    all_letters = {}
    for difficulty, section in bank.items():
        if set(section.keys()) != {"puzzles"}:
            raise ValueError(f"{difficulty}: section must be shaped {{'puzzles': [...]}}")
        puzzles = section["puzzles"]
        validate_section(difficulty, puzzles)
        for p in puzzles:
            if p["letters"] in all_letters:
                raise ValueError(
                    f"letter set {p['letters']!r} used in both "
                    f"{all_letters[p['letters']]!r} and {difficulty!r}"
                )
            all_letters[p["letters"]] = difficulty


def grow_bank(existing, seed, targets):
    """Appends new puzzles to an already-shipped bank without touching a
    single byte of what is there. Each difficulty gets its own reshuffled
    view of the candidate masks, seeded well clear of the original
    generate() stream, and skips every letter set already used by any
    difficulty (the original bank enforces one wheel per difficulty)."""
    words = load_wordlist(WORDLIST_PATH)
    mask_index = build_mask_index(words)
    candidate_masks = sorted({m for m in mask_index if popcount(m) == 7}, key=letters_string)

    seen_letters = set()
    grown_sections = {}
    for difficulty in ("easy", "medium", "hard"):
        for p in existing[difficulty]["puzzles"]:
            seen_letters.add(p["letters"])
    for difficulty in ("hard", "easy", "medium"):
        existing_puzzles = existing[difficulty]["puzzles"]
        needed = max(0, targets[difficulty] - len(existing_puzzles))
        rng = random.Random(f"{seed}-grow-{difficulty}")
        shuffled = list(candidate_masks)
        rng.shuffle(shuffled)
        new_puzzles = generate_section(shuffled, mask_index, rng, difficulty, needed, seen_letters)
        grown_sections[difficulty] = {"puzzles": existing_puzzles + new_puzzles}
    return {d: grown_sections[d] for d in ("easy", "medium", "hard")}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", type=int, default=7, help="deterministic seed")
    ap.add_argument("--easy-count", type=int, default=DIFF_TARGETS["easy"], help="target easy bank size")
    ap.add_argument("--medium-count", type=int, default=DIFF_TARGETS["medium"], help="target medium bank size")
    ap.add_argument("--hard-count", type=int, default=DIFF_TARGETS["hard"], help="target hard bank size")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output JSON path")
    ap.add_argument(
        "--grow-to",
        type=int,
        default=None,
        help="load --in (or --out) and append new puzzles up to this many "
        "per difficulty, leaving every existing puzzle untouched",
    )
    ap.add_argument("--in", dest="in_path", type=Path, default=None)
    args = ap.parse_args()

    if args.grow_to is not None:
        in_path = args.in_path or args.out
        with open(in_path) as f:
            existing = json.load(f)
        targets = {"easy": args.grow_to, "medium": args.grow_to, "hard": args.grow_to}
        bank = grow_bank(existing, args.seed, targets)
    else:
        targets = {"easy": args.easy_count, "medium": args.medium_count, "hard": args.hard_count}
        bank = generate(args.seed, targets)
    validate(bank)

    for difficulty, section in bank.items():
        count = len(section["puzzles"])
        if count < MIN_ACCEPTABLE_BANK:
            print(
                f"warning: {difficulty} only generated {count} puzzles, "
                f"below the {MIN_ACCEPTABLE_BANK} contract minimum",
                file=sys.stderr,
            )

    args.out.write_text(json.dumps(bank, indent=2) + "\n", encoding="utf-8")
    counts = ", ".join(f"{d}={len(bank[d]['puzzles'])}" for d in ("easy", "medium", "hard"))
    print(f"wrote {args.out} ({counts})")


if __name__ == "__main__":
    main()
