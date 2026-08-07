#!/usr/bin/env python3
"""
Deterministic generator for the Heptagram puzzle bank.

For each puzzle we pick 7 unique letters, a center letter that must appear
in every answer, and the exact set of dictionary words (>= 4 letters, built
only from those 7 letters) that count as valid answers. Word count is kept
in the 20-60 range so a puzzle is neither trivial nor a slog, and every
puzzle carries at least one pangram (a word using all 7 letters).

Usage:
    python3 tools/gen_heptagram.py --seed 7 --count 200
    python3 tools/gen_heptagram.py --seed 7 --count 200 --out data/heptagram.json
"""

import argparse
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORDLIST_PATH = ROOT / "data" / "wordlist.txt"
DEFAULT_OUT = ROOT / "data" / "heptagram.json"

MIN_WORD_LEN = 4
MAX_WORD_LEN = 8
MIN_WORDS = 20
MAX_WORDS = 60
PANGRAM_BONUS = 7
DEFAULT_TARGET = 200
MIN_ACCEPTABLE_BANK = 150


def load_wordlist(path):
    words = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            w = line.strip().lower()
            if w and w.isalpha() and len(w) >= MIN_WORD_LEN:
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


def select_words(subset, letters_mask):
    """Shapes an answer set into the [MIN_WORDS, MAX_WORDS] range. Every
    pangram is kept regardless of length (a puzzle needs at least one).
    Ordinary words longer than MAX_WORD_LEN are dropped first, then, if
    still oversized, shorter words are preferred (they skew more common
    in everyday vocabulary). Returns None if it can't reach MIN_WORDS."""
    pangrams = [w for w in subset if is_pangram(w, letters_mask)]
    rest = [w for w in subset if w not in pangrams and len(w) <= MAX_WORD_LEN]

    if len(pangrams) > MAX_WORDS:
        return None
    if len(pangrams) + len(rest) < MIN_WORDS:
        return None
    if len(pangrams) + len(rest) <= MAX_WORDS:
        return sorted(pangrams + rest)

    rest.sort(key=lambda w: (len(w), w))
    room = MAX_WORDS - len(pangrams)
    return sorted(pangrams + rest[:room])


def build_puzzle(letters_mask, mask_index, rng):
    candidate_words = words_for_mask(mask_index, letters_mask)
    letters = letters_string(letters_mask)

    per_center = {}
    for center in letters:
        subset = [w for w in candidate_words if center in w]
        words = select_words(subset, letters_mask)
        if words is not None:
            per_center[center] = words

    if not per_center:
        return None

    center = rng.choice(sorted(per_center))
    words = per_center[center]
    max_score = sum(word_score(w, letters_mask) for w in words)

    return {
        "letters": letters.upper(),
        "center": center.upper(),
        "words": words,
        "maxScore": max_score,
    }


def generate(seed, target):
    words = load_wordlist(WORDLIST_PATH)
    mask_index = build_mask_index(words)

    candidate_masks = sorted({m for m in mask_index if popcount(m) == 7}, key=letters_string)

    rng = random.Random(seed)
    rng.shuffle(candidate_masks)

    puzzles = []
    seen_letters = set()
    for mask in candidate_masks:
        if len(puzzles) >= target:
            break
        puzzle = build_puzzle(mask, mask_index, rng)
        if puzzle is None:
            continue
        if puzzle["letters"] in seen_letters:
            continue
        seen_letters.add(puzzle["letters"])
        puzzles.append(puzzle)

    puzzles.sort(key=lambda p: (p["letters"], p["center"]))
    return puzzles


def validate(puzzles):
    """Hard-validates generator output. Raises on any violation."""
    if len(puzzles) == 0:
        raise ValueError("bank is empty")

    seen_letters = set()
    for i, p in enumerate(puzzles):
        letters = p["letters"]
        center = p["center"]
        words = p["words"]

        if not isinstance(letters, str) or len(letters) != 7:
            raise ValueError(f"puzzle {i}: letters must be a 7-char string, got {letters!r}")
        if len(set(letters)) != 7:
            raise ValueError(f"puzzle {i}: letters must be 7 unique characters, got {letters!r}")
        if letters != letters.upper() or not letters.isalpha():
            raise ValueError(f"puzzle {i}: letters must be uppercase A-Z, got {letters!r}")
        if letters in seen_letters:
            raise ValueError(f"puzzle {i}: duplicate letter set {letters!r}")
        seen_letters.add(letters)

        if not isinstance(center, str) or len(center) != 1 or center not in letters:
            raise ValueError(f"puzzle {i}: center {center!r} must be one of letters {letters!r}")

        if not (MIN_WORDS <= len(words) <= MAX_WORDS):
            raise ValueError(f"puzzle {i}: word count {len(words)} outside [{MIN_WORDS}, {MAX_WORDS}]")
        if words != sorted(words):
            raise ValueError(f"puzzle {i}: words must be sorted")
        if len(words) != len(set(words)):
            raise ValueError(f"puzzle {i}: duplicate words in list")

        letters_mask = mask_of(letters.lower())
        found_pangram = False
        computed_score = 0
        for w in words:
            if len(w) < MIN_WORD_LEN:
                raise ValueError(f"puzzle {i}: word {w!r} shorter than {MIN_WORD_LEN}")
            if center.lower() not in w:
                raise ValueError(f"puzzle {i}: word {w!r} missing center {center!r}")
            wm = mask_of(w)
            if wm & ~letters_mask:
                raise ValueError(f"puzzle {i}: word {w!r} uses letters outside {letters!r}")
            if is_pangram(w, letters_mask):
                found_pangram = True
            computed_score += word_score(w, letters_mask)

        if not found_pangram:
            raise ValueError(f"puzzle {i}: no pangram among words for letters {letters!r}")
        if computed_score != p["maxScore"]:
            raise ValueError(
                f"puzzle {i}: maxScore mismatch, stored {p['maxScore']} computed {computed_score}"
            )


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seed", type=int, default=7, help="deterministic seed")
    ap.add_argument("--count", type=int, default=DEFAULT_TARGET, help="target bank size")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output JSON path")
    args = ap.parse_args()

    puzzles = generate(args.seed, args.count)
    validate(puzzles)

    if len(puzzles) < MIN_ACCEPTABLE_BANK:
        print(
            f"warning: only generated {len(puzzles)} puzzles, below the {MIN_ACCEPTABLE_BANK} target",
            file=sys.stderr,
        )

    bank = {"puzzles": puzzles}
    args.out.write_text(json.dumps(bank, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(puzzles)} puzzles to {args.out}")


if __name__ == "__main__":
    main()
