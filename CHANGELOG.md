# Changelog

## 1.0.0 - 2026-09-25

Bigger banks, a few new features, a license change.

Sudoku, Heptagram, and Clusters: 365 puzzles per difficulty now.
Edgeways: 365/195/90 (easy/medium/hard) - as far as its word pool
goes for medium and hard. A new test pins the exact prefix every bank
had before this pass. Growing a bank can only append from here.

The hub has a "Share today" button. It rolls up every game you
finished today into one message, in each game's own share format.
Hidden until you've finished something. Heptagram has an optional
hints panel now too: word counts by first letter and length, plus
two-letter starts. No words shown, but opening it gets noted on that
day's result. Every game opens its how-to-play once, the first time
you visit it, and never again. Wordrow has a high-contrast color
setting for correct/present tiles, and it carries into the share
emoji.

Every page has social cards, canonical links, Open Graph and Twitter
tags, and JSON-LD now, so a shared link looks like something instead
of a bare URL. The site also runs bundled offline inside the Android
wrapper app: relative paths everywhere, a silent fallback with no
service worker, a native share/theme bridge when the wrapper's there.

Every game's result panel announces itself to screen readers. Shared
buttons, the skip link, and the archive's date links are a real 44px.
Sudoku's cells and Wordrow's keyboard keys still land under that on
narrow phones - same trade-off as before, written up in the README.

License moved from Prosperity to [GPL-3.0-or-later](LICENSE). Commits
before this release stayed under Prosperity.
