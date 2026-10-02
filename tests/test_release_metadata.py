"""The Android version, CHANGELOG.md and the F-Droid changelog have to agree before a release."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRADLE = ROOT / "android" / "app" / "build.gradle.kts"
CHANGELOG = ROOT / "CHANGELOG.md"
FASTLANE_CHANGELOGS = ROOT / "fastlane" / "metadata" / "android" / "en-US" / "changelogs"


def gradle_version():
    text = GRADLE.read_text(encoding="utf-8")
    name = re.search(r'versionName = "([^"]+)"', text).group(1)
    code = int(re.search(r"versionCode = (\d+)", text).group(1))
    return name, code


def test_version_name_matches_the_newest_changelog_release():
    name, _ = gradle_version()
    released = re.search(r"^## (\d+\.\d+\.\d+)", CHANGELOG.read_text(encoding="utf-8"), re.M)
    assert released, "CHANGELOG.md has no released version heading"
    assert name == released.group(1), f"build.gradle.kts says {name}, CHANGELOG.md's newest release is {released.group(1)}"


def test_version_code_follows_the_version_name():
    name, code = gradle_version()
    major, minor, patch = (int(n) for n in name.split("."))
    assert code == major * 10000 + minor * 100 + patch, f"versionCode {code} doesn't match versionName {name}"


def test_fdroid_has_a_changelog_for_this_version_code():
    _, code = gradle_version()
    path = FASTLANE_CHANGELOGS / f"{code}.txt"
    assert path.is_file(), f"missing {path.relative_to(ROOT)}"
    text = path.read_text(encoding="utf-8").strip()
    assert text, f"{path.name} is empty"
    assert len(text) <= 500, f"{path.name} is {len(text)} characters, over the 500 limit"
