# Changelog

## Unreleased

Leave a game open past midnight and it used to file the result under the
wrong day. Now it records against the puzzle's own date. Come back to the
tab later and it offers a link to the new one. The hub redraws itself too.
Streaks that lapsed show 0 instead of the old number; Best keeps it.

Edgeways hard would have started repeating on November 8 with only 90
puzzles. It has a full year now and medium is up to 268. Spice, hospice
and 82 other real words that Edgeways refused now count. Edgeways and
Wordrow also turn away the same slurs and crude words as the other games,
and that shared list grew from 127 words to 202.

Wordrow now reads each guess to screen readers one letter at a time. It
says whether each one is correct, in the word or not in it, and the keys
do the same. Minigrid cells mention when they are marked wrong or
revealed. Edgeways letters say when they are used.

Smaller fixes. Clusters does not take a mistake for sending the same four
tiles twice. Archive days open offline. On Android 7 to 11 the app's
backups had been failing without a word, so a restore lost every streak.
That is fixed in the next release of the app (see the
[Roadmap](https://github.com/munzzyy/puzzlepress#roadmap)).

## 1.0.2 - 2026-10-01

A new icon: a small crossword grid on press red, in place of the navy P,
so Puzzle Press stands apart from the other apps. Nothing else changed.

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
