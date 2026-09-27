# Changelog

## 1.0.1 - 2026-09-27

The Android build is now shrunk with R8, as F-Droid asked, so the
download is smaller. Nothing else changed.

## 1.0.0 - 2026-09-25

The big one was running out of puzzles. Minigrid had already started
repeating and Wordweave was ten days behind it, so every bank grew:
Sudoku, Heptagram and Clusters to 365 per difficulty, Wordweave to about
200 with some 420 new themes, Minigrid to 200/148/200 with around 650
newly clued words, and Edgeways to 365/195/90. Nothing that already
shipped moved. A test pins every bank's old entries by hash, so a
growth pass can only ever append.

I also found crude and hateful words in there. The big dictionaries
allow them, so Heptagram would take a slur as an answer and Wordweave
would count a few as bonus words, in puzzles that had already gone out.
A shared blocklist now drops them when a puzzle loads, and the
generators skip them.

New things to play with: a "Share today" button on the hub that rolls
up everything you finished into one message, a hints panel for
Heptagram (counts only, no words, and it gets noted on your result),
a high-contrast color option for Wordrow that carries into the share
emoji, and how-to-play opening on its own the first time you try a game.

Shared links get proper preview cards now. Result panels speak up for
screen readers, and the small buttons grew to 44px, except Sudoku's cells
and Wordrow's keys, which can't fit at that size on a narrow phone (the
README explains). The site also runs offline inside the new Android app,
where Back closes an open dialog before it leaves a game.

Puzzle Press is now GPL-3.0-or-later. Commits before this release were
under Prosperity.
