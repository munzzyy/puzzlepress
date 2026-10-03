"""sw.js serves precached files cache-first, so an installed copy only picks
up a change to one of them when CACHE_VERSION goes up.

SW_PINS ties each CACHE_VERSION to a hash of every precached path and its
contents. Change a precached file and the hash moves, so the test fails
until CACHE_VERSION is bumped and the new (version, hash) is appended.

Run: pytest tests/test_service_worker.py
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SW = ROOT / "sw.js"

# (CACHE_VERSION, precache_hash()), oldest first. Append only.
SW_PINS = [
    (31, "25ba9f53da9ab3a73ecc45ad298ece85a757b1d0f7a49d8b6496eb6fe1d245da"),
    (32, "c11b421ba73b17e2c760bdcee77f18578733354c6207a9680a2b467b09755786"),
]

ROOT_FILES = ["index.html", "archive.html", "404.html", "robots.txt", "manifest.webmanifest"]


def parse_sw():
    text = SW.read_text(encoding="utf-8")
    version = re.search(r"^const CACHE_VERSION = (\d+);", text, re.M)
    games = re.search(r"^const GAMES = \[(.*?)\];", text, re.M | re.S)
    precache = re.search(r"^const PRECACHE = \[(.*?)\];", text, re.M | re.S)
    loop = re.search(r"^for \(const id of GAMES\) \{\s*PRECACHE\.push\((.*?)\);\s*\}", text, re.M | re.S)
    assert version and games and precache and loop, "sw.js changed shape; update parse_sw()"

    paths = re.findall(r'"([^"]+)"', precache.group(1))
    for template in re.findall(r"`([^`]+)`", loop.group(1)):
        assert template.count("${") == template.count("${id}"), f"can't expand {template}"
        paths += [template.replace("${id}", game) for game in re.findall(r'"([^"]+)"', games.group(1))]
    return int(version.group(1)), paths


def local_file(path):
    assert path.startswith("./"), f"{path} isn't relative to the worker"
    return ROOT / (path[2:] or "index.html")


def runtime_files():
    files = {ROOT / name for name in ROOT_FILES}
    for top in ("assets", "games"):
        files |= {p for p in (ROOT / top).rglob("*") if p.is_file() and not p.name.endswith(".test.mjs")}
    files |= set((ROOT / "data").glob("*.json"))
    return files


def precache_hash(paths):
    digest = hashlib.sha256()
    for path in sorted(paths):
        # The Windows CI leg checks text files out with CRLF.
        data = local_file(path).read_bytes().replace(b"\r\n", b"\n")
        digest.update(path.encode() + b"\0" + len(data).to_bytes(8, "big") + data)
    return digest.hexdigest()


def test_every_precached_path_exists_once():
    _, paths = parse_sw()
    duplicates = sorted({p for p in paths if paths.count(p) > 1})
    assert not duplicates, f"cache.addAll() rejects duplicates: {duplicates}"
    missing = [p for p in paths if not local_file(p).is_file()]
    assert not missing, f"sw.js precaches files that don't exist: {missing}"


def test_every_runtime_file_is_precached():
    _, paths = parse_sw()
    precached = {local_file(p) for p in paths}
    left_out = sorted(p.relative_to(ROOT).as_posix() for p in runtime_files() - precached)
    assert not left_out, f"add these to PRECACHE in sw.js so they work offline: {left_out}"


def test_cache_version_moves_with_the_precached_files():
    version, paths = parse_sw()
    pinned_version, pinned_hash = SW_PINS[-1]
    current = precache_hash(paths)
    assert version == pinned_version, (
        f"CACHE_VERSION is {version} but the newest pin is {pinned_version}: append ({version}, \"{current}\") to SW_PINS"
    )
    assert current == pinned_hash, (
        f"precached files changed but CACHE_VERSION is still {version}: bump it in sw.js"
        f" and append ({version + 1}, \"{current}\") to SW_PINS"
    )


def test_pinned_versions_only_go_up():
    versions = [v for v, _ in SW_PINS]
    assert all(a < b for a, b in zip(versions, versions[1:])), f"SW_PINS versions must increase: {versions}"
