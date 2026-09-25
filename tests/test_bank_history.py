"""Append-only guard for every daily bank.

Puzzle Press promises that a puzzle you already played never changes under
you: growing a bank only ever appends past the end. This pins the exact
prefix each bank had as of commit c8141843 (the last commit before the
2026-09 growth pass) by hashing the JSON of its first N entries, and checks
that the bank as it stands today still starts with exactly that content.
The bank is free to grow past N; it just can't touch entries 0..N-1.

Run: pytest tests/test_bank_history.py
"""
import hashlib
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

# (field name inside each difficulty section, {difficulty: (prefix length, sha256 of that prefix's JSON)})
# The hashes were computed once, straight from `git show c8141843:data/<game>.json`,
# with `json.dumps(entries, sort_keys=True, separators=(",", ":"))`.
BANKS = {
    "clusters": (
        "puzzles",
        {
            "easy": (100, "d5e81630306ff55a378c9ce18204d36899486b6d6c3abcfb0145b10ed77a32a8"),
            "medium": (100, "dfbde6d9bd655006e133cab5ac4103877ad6db0200886b01633741ef23af3d2b"),
            "hard": (100, "830c741c80b2cf0505e49b7800ab4ef5f96ce90050f97e1c3bad07a2cc1a8296"),
        },
    ),
    "edgeways": (
        "puzzles",
        {
            "easy": (100, "cc578f45fee4330f07ac7362ef9eef6ce01ebd0bdc54440574f21768bf307609"),
            "medium": (140, "8eedaee45693fb943f6c1530976b533015f325c74bbf79477932026982a34116"),
            "hard": (90, "f93f278b5d1953e60dd2212a88fa9c4a20f8f02d36fc6c6efd18be8a8e83f3ea"),
        },
    ),
    "heptagram": (
        "puzzles",
        {
            "easy": (150, "2cb57fe5779239edd91d86c94a093f1f32d6b4ce200d379a7c54a9b1a376d8d2"),
            "medium": (200, "3ab36ac9828fb84548b15c8404703b7bcf39afc8b55026bb50fcfba66e427e4d"),
            "hard": (150, "5c7257f1d7fc6e8e1f5c1ecb8d15dfb8a8c2e1f65ebeec10909200f59f9e1042"),
        },
    ),
    "minigrid": (
        "puzzles",
        {
            "easy": (45, "74cd43b405a36f1080a28d5e22bb536484fca6dce59c356fb3949fd60de44a1f"),
            "medium": (45, "afd6adc95c61efed47d7bf33b201045ac52c3c23c9eb8bd57df20449232622c5"),
            "hard": (40, "ecaf29bb6ed6f25ea71563d5d7a398f7ef4015604d8560ec80d4052d38cef9f5"),
        },
    ),
    "sudoku": (
        "puzzles",
        {
            "easy": (130, "6ec928836160e32325dd5717c789c69cd252c41a76e62a7ff46e3e90b0f4f705"),
            "medium": (130, "5a9ed6a18d7820fa682c87ba35a5f760f7ca49216af760e7c945372f8e118560"),
            "hard": (130, "9c350f21f4af41090ff524e0b3b8343843e056bf3207855934ad8953037b9191"),
        },
    ),
    "wordrow": (
        "answers",
        {
            "easy": (301, "ee012033b45cee3acff75bef5b1656f1e4d4cbba0a1bcea0c4d3090437513c9c"),
            "medium": (795, "49c38da3cc848ad8e3524fb4ff292cc1df11908318e890f7dd8156633f4d29fc"),
            "hard": (245, "9efe6b718594f1fd6ed4153ee360cef50ef09764e8b58dce838df190c1508ec7"),
        },
    ),
    "wordweave": (
        "puzzles",
        {
            "easy": (60, "86addf653daa91c1ebb56904411087902a07a63b584173e29cef9e2444bf8c65"),
            "medium": (60, "214c731c78d52f7a46c9079d879bdfe79c9075b12686cc75df5676fe4b9c943a"),
            "hard": (59, "decc33d18d182e0b9a8bc628d791c0a1909e74c1625ea646638d17d628418960"),
        },
    ),
}


def prefix_hash(entries):
    blob = json.dumps(entries, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


CASES = [
    (game, diff, field, n, digest)
    for game, (field, tiers) in BANKS.items()
    for diff, (n, digest) in tiers.items()
]


@pytest.mark.parametrize("game,diff,field,n,digest", CASES, ids=[f"{g}-{d}" for g, d, *_ in CASES])
def test_bank_starts_with_its_pinned_prefix(game, diff, field, n, digest):
    bank = json.loads((ROOT / "data" / f"{game}.json").read_text(encoding="utf-8"))
    entries = bank[diff][field]
    assert len(entries) >= n, f"{game}/{diff} shrank below its pinned prefix of {n}"
    assert prefix_hash(entries[:n]) == digest, f"{game}/{diff} changed an entry inside its pinned prefix"


def test_pinned_prefix_hash_catches_a_changed_entry():
    game, diff, field = "clusters", "easy", "puzzles"
    n, digest = BANKS[game][1][diff]
    bank = json.loads((ROOT / "data" / f"{game}.json").read_text(encoding="utf-8"))
    tampered = json.loads(json.dumps(bank[diff][field][:n]))
    tampered[0] = {"tampered": True}
    assert prefix_hash(tampered) != digest
