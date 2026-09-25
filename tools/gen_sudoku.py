#!/usr/bin/env python3
"""Builds data/sudoku.json: a deterministic, difficulty-graded sudoku bank.

Stdlib only. For each difficulty (easy, medium, hard):
  1. Generate a full solved grid with a seeded, randomized backtracking fill.
  2. Carve blanks out of it one at a time, in a shuffled order, keeping only
     removals that leave the puzzle with exactly one solution (checked with
     a bitmask backtracking solver that stops as soon as it finds a second).
  3. Grade the resulting puzzle by the human techniques needed to finish it
     (singles only -> easy; + locked candidates and pairs -> medium; needs a
     search/guess -> hard) and keep it only if it lands on the target tier.

Run: python3 tools/gen_sudoku.py [--seed N] [--count N] [--out PATH]
"""

import argparse
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "data", "sudoku.json")

DIGITS = tuple(range(1, 10))

# ---------- grid geometry ----------


def row_of(i):
    return i // 9


def col_of(i):
    return i % 9


def box_of(i):
    r, c = row_of(i), col_of(i)
    return (r // 3) * 3 + c // 3


def row_indices(r):
    return [r * 9 + c for c in range(9)]


def col_indices(c):
    return [r * 9 + c for r in range(9)]


def box_indices(b):
    br, bc = (b // 3) * 3, (b % 3) * 3
    return [(br + r) * 9 + (bc + c) for r in range(3) for c in range(3)]


ROWS = [row_indices(r) for r in range(9)]
COLS = [col_indices(c) for c in range(9)]
BOXES = [box_indices(b) for b in range(9)]
ALL_GROUPS = ROWS + COLS + BOXES

PEERS = []
for i in range(81):
    r, c, b = row_of(i), col_of(i), box_of(i)
    s = set(ROWS[r]) | set(COLS[c]) | set(BOXES[b])
    s.discard(i)
    PEERS.append(sorted(s))


# ---------- full grid generation ----------


def generate_solved_grid(rng):
    """Randomized backtracking fill of an empty 9x9 grid."""
    grid = [0] * 81

    def valid(i, v):
        for p in PEERS[i]:
            if grid[p] == v:
                return False
        return True

    def backtrack(i):
        if i == 81:
            return True
        if grid[i] != 0:
            return backtrack(i + 1)
        candidates = list(DIGITS)
        rng.shuffle(candidates)
        for v in candidates:
            if valid(i, v):
                grid[i] = v
                if backtrack(i + 1):
                    return True
                grid[i] = 0
        return False

    ok = backtrack(0)
    if not ok:
        raise RuntimeError("sudoku: failed to fill a grid (should not happen)")
    return grid


# ---------- uniqueness (bitmask backtracking, stops at `limit` solutions) ----------


def count_solutions(cells, limit=2):
    rows = [0] * 9
    cols = [0] * 9
    boxes = [0] * 9
    empties = []
    for i, v in enumerate(cells):
        r, c, b = row_of(i), col_of(i), box_of(i)
        if v:
            bit = 1 << v
            rows[r] |= bit
            cols[c] |= bit
            boxes[b] |= bit
        else:
            empties.append(i)

    count = 0

    def backtrack(pos):
        nonlocal count
        if pos == len(empties):
            count += 1
            return count >= limit

        best_at = -1
        best_cands = None
        for idx in range(pos, len(empties)):
            i = empties[idx]
            r, c, b = row_of(i), col_of(i), box_of(i)
            used = rows[r] | cols[c] | boxes[b]
            cands = [v for v in DIGITS if not (used & (1 << v))]
            if best_cands is None or len(cands) < len(best_cands):
                best_at, best_cands = idx, cands
                if len(cands) <= 1:
                    break

        if not best_cands:
            return False

        empties[pos], empties[best_at] = empties[best_at], empties[pos]
        i = empties[pos]
        r, c, b = row_of(i), col_of(i), box_of(i)
        for v in best_cands:
            bit = 1 << v
            rows[r] |= bit
            cols[c] |= bit
            boxes[b] |= bit
            stop = backtrack(pos + 1)
            rows[r] &= ~bit
            cols[c] &= ~bit
            boxes[b] &= ~bit
            if stop:
                return True
        return False

    backtrack(0)
    return count


# ---------- puzzle carving ----------


def carve_puzzle(solution, rng, min_clues):
    """Removes cells from a full solution while keeping a unique solution.
    Stops once no more cells can be removed, or `min_clues` is reached."""
    puzzle = solution[:]
    order = list(range(81))
    rng.shuffle(order)

    clues = 81
    for i in order:
        if clues <= min_clues:
            break
        saved = puzzle[i]
        puzzle[i] = 0
        if count_solutions(puzzle, limit=2) == 1:
            clues -= 1
        else:
            puzzle[i] = saved
    return puzzle


# ---------- technique-tiered grading ----------
#
# A puzzle's difficulty is graded by the weakest solver tier that can finish
# it, working from a copy so the puzzle itself is untouched:
#   easy   - naked singles and hidden singles only
#   medium - + naked pairs and locked candidates (pointing / box-line)
#   hard   - needs anything beyond that (a search/guess)


def candidates_grid(cells):
    cands = [None] * 81
    for i in range(81):
        if cells[i] != 0:
            continue
        used = set()
        for p in PEERS[i]:
            if cells[p]:
                used.add(cells[p])
        cands[i] = set(DIGITS) - used
    return cands


def apply_naked_singles(cells, cands):
    progress = False
    for i in range(81):
        if cells[i] == 0 and cands[i] is not None and len(cands[i]) == 1:
            v = next(iter(cands[i]))
            cells[i] = v
            cands[i] = None
            for p in PEERS[i]:
                if cands[p] is not None:
                    cands[p].discard(v)
            progress = True
    return progress


def apply_hidden_singles(cells, cands):
    progress = False
    for group in ALL_GROUPS:
        for v in DIGITS:
            spots = [i for i in group if cells[i] == 0 and cands[i] is not None and v in cands[i]]
            if len(spots) == 1:
                i = spots[0]
                if cells[i] == 0:
                    cells[i] = v
                    cands[i] = None
                    for p in PEERS[i]:
                        if cands[p] is not None:
                            cands[p].discard(v)
                    progress = True
    return progress


def apply_naked_pairs(cands):
    progress = False
    for group in ALL_GROUPS:
        pairs = {}
        for i in group:
            c = cands[i]
            if c is not None and len(c) == 2:
                key = frozenset(c)
                pairs.setdefault(key, []).append(i)
        for key, cells_with in pairs.items():
            if len(cells_with) != 2:
                continue
            for i in group:
                if i in cells_with:
                    continue
                c = cands[i]
                if c is not None and (c & key):
                    if c - key != c:
                        progress = True
                    cands[i] = c - key
    return progress


def apply_locked_candidates(cands):
    """Pointing pairs/triples (box -> row/col) and box-line reduction
    (row/col -> box), both directions of the same elimination rule."""
    progress = False
    for b, box in enumerate(BOXES):
        for v in DIGITS:
            spots = [i for i in box if cands[i] is not None and v in cands[i]]
            if not spots:
                continue
            rows = {row_of(i) for i in spots}
            if len(rows) == 1:
                r = next(iter(rows))
                for i in ROWS[r]:
                    if i not in box and cands[i] is not None and v in cands[i]:
                        cands[i].discard(v)
                        progress = True
            cols = {col_of(i) for i in spots}
            if len(cols) == 1:
                c = next(iter(cols))
                for i in COLS[c]:
                    if i not in box and cands[i] is not None and v in cands[i]:
                        cands[i].discard(v)
                        progress = True
    for groups in (ROWS, COLS):
        for group in groups:
            for v in DIGITS:
                spots = [i for i in group if cands[i] is not None and v in cands[i]]
                if not spots:
                    continue
                boxes_hit = {box_of(i) for i in spots}
                if len(boxes_hit) == 1:
                    b = next(iter(boxes_hit))
                    for i in BOXES[b]:
                        if i not in group and cands[i] is not None and v in cands[i]:
                            cands[i].discard(v)
                            progress = True
    return progress


def solved_by(cells, tier):
    """Runs a copy of `cells` through solver tiers up to `tier`
    ("easy" or "medium") and reports whether it fully solves. Candidates
    persist across passes: an elimination from a pairs/locked-candidates
    pass has to survive into the next singles pass or it is wasted."""
    work = cells[:]
    cands = candidates_grid(work)
    for _ in range(200):
        progress = apply_naked_singles(work, cands)
        progress = apply_hidden_singles(work, cands) or progress
        if tier == "medium":
            progress = apply_naked_pairs(cands) or progress
            progress = apply_locked_candidates(cands) or progress
        if not progress:
            break
        if all(v != 0 for v in work):
            break
    return all(v != 0 for v in work)


def grade_puzzle(cells):
    if solved_by(cells, "easy"):
        return "easy"
    if solved_by(cells, "medium"):
        return "medium"
    return "hard"


# ---------- validation ----------


def is_valid_solution(cells):
    if len(cells) != 81:
        return False
    for group in ALL_GROUPS:
        if sorted(cells[i] for i in group) != list(DIGITS):
            return False
    return True


def clues_match_solution(puzzle, solution):
    return all(v == 0 or v == solution[i] for i, v in enumerate(puzzle))


# ---------- generation loop ----------

TARGETS = {
    "easy": {"min_clues": 36, "max_attempts": 400},
    "medium": {"min_clues": 30, "max_attempts": 600},
    "hard": {"min_clues": 24, "max_attempts": 1200},
}


def make_one(rng, difficulty):
    spec = TARGETS[difficulty]
    for _ in range(spec["max_attempts"]):
        solution = generate_solved_grid(rng)
        puzzle = carve_puzzle(solution, rng, spec["min_clues"])
        if not clues_match_solution(puzzle, solution):
            continue
        if count_solutions(puzzle, limit=2) != 1:
            continue
        if grade_puzzle(puzzle) != difficulty:
            continue
        return puzzle, solution
    return None, None


def build_bank(seed, count):
    rng = random.Random(seed)
    bank = {}
    seen = {}
    for difficulty in ("easy", "medium", "hard"):
        puzzles = []
        seen_strings = set()
        misses = 0
        while len(puzzles) < count:
            puzzle, solution = make_one(rng, difficulty)
            if puzzle is None:
                misses += 1
                if misses > 20:
                    print(
                        f"warning: stopped {difficulty} early at {len(puzzles)}"
                        f"/{count} after repeated failed attempts",
                        file=sys.stderr,
                    )
                    break
                continue
            ps = "".join(map(str, puzzle))
            if ps in seen_strings:
                continue
            seen_strings.add(ps)
            puzzles.append(
                {"puzzle": ps, "solution": "".join(map(str, solution))}
            )
        bank[difficulty] = {"puzzles": puzzles}
        seen[difficulty] = len(puzzles)
    return bank, seen


def validate_bank(bank):
    """Hard self-check before writing anything to disk."""
    for difficulty, data in bank.items():
        puzzles = data["puzzles"]
        if len(puzzles) == 0:
            raise AssertionError(f"{difficulty}: empty bank")
        for idx, entry in enumerate(puzzles):
            p, s = entry["puzzle"], entry["solution"]
            if len(p) != 81 or len(s) != 81:
                raise AssertionError(f"{difficulty}[{idx}]: wrong length")
            if not all(ch in "0123456789" for ch in p):
                raise AssertionError(f"{difficulty}[{idx}]: bad puzzle chars")
            if not all(ch in "123456789" for ch in s):
                raise AssertionError(f"{difficulty}[{idx}]: bad solution chars")
            pc = [int(ch) for ch in p]
            sc = [int(ch) for ch in s]
            if not is_valid_solution(sc):
                raise AssertionError(f"{difficulty}[{idx}]: solution is not a valid grid")
            if not clues_match_solution(pc, sc):
                raise AssertionError(f"{difficulty}[{idx}]: puzzle clues disagree with solution")
            if count_solutions(pc, limit=2) != 1:
                raise AssertionError(f"{difficulty}[{idx}]: puzzle solution is not unique")
            if grade_puzzle(pc) != difficulty:
                raise AssertionError(f"{difficulty}[{idx}]: grades as {grade_puzzle(pc)}, not {difficulty}")


def grow_bank(existing, seed, target, max_misses=4000):
    """Appends new puzzles to an already-shipped bank without touching a
    single byte of what is there. Each difficulty gets its own RNG, seeded
    well clear of the original build_bank stream, so growth never disturbs
    the draw order that produced the puzzles already committed to disk."""
    grown = {}
    for difficulty in ("easy", "medium", "hard"):
        existing_puzzles = existing[difficulty]["puzzles"]
        seen_strings = {p["puzzle"] for p in existing_puzzles}
        rng = random.Random(f"{seed}-grow-{difficulty}")
        new_puzzles = list(existing_puzzles)
        misses = 0
        while len(new_puzzles) < target and misses < max_misses:
            puzzle, solution = make_one(rng, difficulty)
            if puzzle is None:
                misses += 1
                continue
            ps = "".join(map(str, puzzle))
            if ps in seen_strings:
                misses += 1
                continue
            seen_strings.add(ps)
            new_puzzles.append(
                {"puzzle": ps, "solution": "".join(map(str, solution))}
            )
        grown[difficulty] = {"puzzles": new_puzzles}
    return grown


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=20260810)
    parser.add_argument("--count", type=int, default=100, help="puzzles per difficulty")
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument(
        "--grow-to",
        type=int,
        default=None,
        help="load --out (or --in) and append new puzzles up to this many per "
        "difficulty, leaving every existing puzzle untouched",
    )
    parser.add_argument("--in", dest="in_path", default=None)
    args = parser.parse_args()

    if args.grow_to is not None:
        in_path = args.in_path or args.out
        with open(in_path) as f:
            existing = json.load(f)
        bank = grow_bank(existing, args.seed, args.grow_to)
        validate_bank(bank)
        counts = {d: len(bank[d]["puzzles"]) for d in bank}
    else:
        bank, counts = build_bank(args.seed, args.count)
        validate_bank(bank)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(bank, f, indent=None, separators=(",", ":"))
        f.write("\n")

    for difficulty, n in counts.items():
        print(f"{difficulty}: {n} puzzles")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
