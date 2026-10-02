"""Append-only guard for every daily bank.

Puzzle Press promises that a puzzle you already played never changes under
you: growing a bank only ever appends past the end. This pins the exact
prefix each bank had as of commit c8141843 (the last commit before the
2026-09 growth pass) by hashing the JSON of its first N entries, and checks
that the bank as it stands today still starts with exactly that content.
The bank is free to grow past N; it just can't touch entries 0..N-1.

A second table pins every entry each bank had when v1.0.0 shipped, so the
entries the growth pass appended are held to the same rule.

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


# Full banks as of the v1.0.0 tag, hashed the same way from `git show v1.0.0:data/<game>.json`.
SHIPPED_1_0_0 = {
    "clusters": (
        "puzzles",
        {
            "easy": (365, "e60e061886d5bf583074f376e943491048ad23a929eee89153db0cdd7073d1e0"),
            "medium": (365, "7c86633a7f8c46f3201e9c1ca28a4a34ea251d158da01146a11a8221cd0cd0a0"),
            "hard": (365, "e6fce528c990bcb1eaa7a5890ed4bb844a1ac15bd5ca2c26a93412019a255d1f"),
        },
    ),
    "edgeways": (
        "puzzles",
        {
            "easy": (365, "188330b836ad5cd96920f63d15077ebdf890df68fab0211deaf34ea1c48e5e17"),
            "medium": (195, "8cff3ff397fa72061bcd253310993c57a3530685ec6311cd9b91255022c43ba7"),
            "hard": (90, "f93f278b5d1953e60dd2212a88fa9c4a20f8f02d36fc6c6efd18be8a8e83f3ea"),
        },
    ),
    "heptagram": (
        "puzzles",
        {
            "easy": (365, "4951c1e6be82592f0f6cb0c1904a8a2c5dec36def2058771dbbaaed3143e81d3"),
            "medium": (365, "511b925ed15105aba5f686aab8728ca24975722f5ec701b180621d883255126c"),
            "hard": (365, "503c345989a3d6143b7cdbe97624aa974a166d8f18d8aee4270e03f0a7021140"),
        },
    ),
    "minigrid": (
        "puzzles",
        {
            "easy": (200, "ebedd759ce90c03ad93a78e00c301e8fb6062592f750e19df754381b8f99766e"),
            "medium": (148, "fa65181d78e35249ef702a35188f70ccc86a97a93ad8a0828655a004592863f1"),
            "hard": (200, "4ff0127008913ad428000c000b480a15a72229cc31f74ee48e6110d638982146"),
        },
    ),
    "sudoku": (
        "puzzles",
        {
            "easy": (365, "be4fcf28f895a52db2e3bcd80e0f1582e3f5a8c3d617ec0fa1a31a21dd15ee85"),
            "medium": (365, "8bb740ea42e464db613e48abfdf0667801fa931bed849acf5245a73ed9f300ce"),
            "hard": (365, "e6eac855e4b1860d950e0d90e29e15289a2e7c562956c3c3b7b4ef1b91767b7b"),
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
            "easy": (201, "f7bcd4de77c825ee02682ff192b28b7a2842b84cfe725bfc2e61e709cef7e326"),
            "medium": (200, "d755108a2d553a49e602996c01af6d85623ee087cf8ccd18568f44e4496204bf"),
            "hard": (200, "86f3d1a0b2267452e2ff8faab565d40278cbb416def9ff744cafe3d14f29a5c2"),
        },
    ),
}


def prefix_hash(entries):
    blob = json.dumps(entries, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def cases(table):
    return [
        (game, diff, field, n, digest)
        for game, (field, tiers) in table.items()
        for diff, (n, digest) in tiers.items()
    ]


CASES = cases(BANKS)
SHIPPED_CASES = cases(SHIPPED_1_0_0)


def ids(rows):
    return [f"{g}-{d}" for g, d, *_ in rows]


@pytest.mark.parametrize("game,diff,field,n,digest", CASES, ids=ids(CASES))
def test_bank_starts_with_its_pinned_prefix(game, diff, field, n, digest):
    bank = json.loads((ROOT / "data" / f"{game}.json").read_text(encoding="utf-8"))
    entries = bank[diff][field]
    assert len(entries) >= n, f"{game}/{diff} shrank below its pinned prefix of {n}"
    assert prefix_hash(entries[:n]) == digest, f"{game}/{diff} changed an entry inside its pinned prefix"


@pytest.mark.parametrize("game,diff,field,n,digest", SHIPPED_CASES, ids=ids(SHIPPED_CASES))
def test_bank_keeps_everything_shipped_in_1_0_0(game, diff, field, n, digest):
    bank = json.loads((ROOT / "data" / f"{game}.json").read_text(encoding="utf-8"))
    entries = bank[diff][field]
    assert len(entries) >= n, f"{game}/{diff} shrank below the {n} entries it shipped with in 1.0.0"
    assert prefix_hash(entries[:n]) == digest, f"{game}/{diff} changed an entry that shipped in 1.0.0"


def test_pinned_prefix_hash_catches_a_changed_entry():
    game, diff, field = "clusters", "easy", "puzzles"
    n, digest = BANKS[game][1][diff]
    bank = json.loads((ROOT / "data" / f"{game}.json").read_text(encoding="utf-8"))
    tampered = json.loads(json.dumps(bank[diff][field][:n]))
    tampered[0] = {"tampered": True}
    assert prefix_hash(tampered) != digest
