"""Streaks are claimed to live on the phone and nowhere else (fastlane
full_description.txt). Cloud backup has to actually be excluded for that
to be true on every supported Android version, while a direct
device-to-device transfer still carries the data.

Run: pytest tests/test_android_backup.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANDROID = ROOT / "android" / "app" / "src" / "main"
MANIFEST = ANDROID / "AndroidManifest.xml"
DATA_EXTRACTION = ANDROID / "res" / "xml" / "data_extraction_rules.xml"
BACKUP_RULES = ANDROID / "res" / "xml" / "backup_rules.xml"
FULL_DESCRIPTION = ROOT / "fastlane" / "metadata" / "android" / "en-US" / "full_description.txt"


def test_the_store_listing_still_makes_the_claim():
    text = FULL_DESCRIPTION.read_text(encoding="utf-8")
    assert "Your streaks live on your phone and nowhere else" in text


def test_android_12_plus_excludes_cloud_backup_but_keeps_device_transfer():
    text = DATA_EXTRACTION.read_text(encoding="utf-8")
    cloud = re.search(r"<cloud-backup\b[^>]*>(.*?)</cloud-backup>", text, re.S)
    assert cloud, "data_extraction_rules.xml needs a <cloud-backup> section"
    assert re.search(r'<exclude\s+domain="root"\s+path="\."\s*/>', cloud.group(1)), (
        "cloud-backup has to exclude everything, or streaks reach a server backup"
    )
    assert "<device-transfer" in text, "device-transfer should stay on so a phone switch still carries streaks"


def test_android_11_and_below_excludes_backup_entirely():
    text = BACKUP_RULES.read_text(encoding="utf-8")
    assert re.search(r'<exclude\s+domain="root"\s+path="\."\s*/>', text), (
        "fullBackupContent is what Android 11 and older actually read; "
        "it has no separate device-transfer channel, so it has to exclude everything"
    )


def test_manifest_wires_both_backup_files():
    text = MANIFEST.read_text(encoding="utf-8")
    assert 'android:fullBackupContent="@xml/backup_rules"' in text
    assert 'android:dataExtractionRules="@xml/data_extraction_rules"' in text


def test_sw_registration_skips_the_android_wrapper():
    # sw.js isn't synced into the APK's assets (see android/app/build.gradle.kts),
    # so registering it inside the wrapper can only fail; skip it there and
    # keep registering it on the real site, where the worker is real.
    guard = 'location.hostname !== "appassets.androidplatform.net"'
    for page in ("index.html", "archive.html"):
        text = (ROOT / page).read_text(encoding="utf-8")
        match = re.search(r'if \("serviceWorker" in navigator([^)]*)\)', text)
        assert match, f"{page} dropped its serviceWorker registration"
        assert guard in match.group(1), f"{page} registers sw.js even inside the Android wrapper"

