# Puzzle Press

Seven daily puzzles on one static page. Plain HTML, CSS and JS with zero
dependencies, and nothing asks you to sign in. Play at
https://puzzlepress.munzzyy.dev/ or serve the folder yourself.

| Light | Dark |
| --- | --- |
| ![Hub in light mode](docs/shots/hub-light.png) | ![Hub in dark mode](docs/shots/hub-dark.png) |

## The games

Wordrow gives you six tries at a five letter word, with a hard mode if you
want it. Clusters asks you to sort sixteen tiles into four themed groups
before your fourth mistake. Heptagram hands you seven letters and one of them
has to appear in every word you build. Minigrid is a 5x5 crossword
with its own clues. Wordweave hides theme words in a grid of letters;
one of them spans the board and names the theme. Edgeways puts twelve letters
around a square and you chain words until every letter is used. Sudoku is
the classic, with pencil marks and undo.

![Wordrow mid-game](docs/shots/wordrow.png)

More screenshots live in [docs/shots](docs/shots).

## Difficulties

Every game comes in easy, medium and hard, and each difficulty is its own
daily: a separate puzzle drawn from a separate bank, with its own streak and
stats. Progress you had before difficulties existed carries over as your
medium record, nothing is lost. What "hard" means depends on the game:

| Game | Easy | Medium | Hard |
| --- | --- | --- | --- |
| Wordrow | very common answers, 7 guesses | the original answer pool, 6 guesses | less common answers, hard mode always on |
| Clusters | distinct themes, no decoys | the standard mix | words that plausibly fit another group |
| Heptagram | common letters, short word list | the standard wheel | 40+ words or a rare letter, top rank needs the pangram |
| Minigrid | everyday fill, plain clues | the standard bank | trickier fill and clue angles |
| Wordweave | 6x6 grid, theme shown up front | 6x8 grid | theme hidden until you find the spanning word |
| Edgeways | par 3, common letters | par 2 | par 2 with a J, Q, X or Z on the square |
| Sudoku | few empty cells | more empty cells | needs real technique |

## Extras

The hub has a "Share today" button that rolls up every game you finished
today into one message, each in that game's own share format. It's hidden
until you've actually finished something.

Heptagram has an optional hints panel: word counts by first letter and
length, plus two-letter starts. No words shown, but opening it does get
noted on that day's result.

Every game opens its how-to-play automatically the first time you visit it,
then leaves you alone after that.

Wordrow has a persisted high-contrast setting that swaps the tile colors for
a pair with a bigger contrast gap, carried into the share emoji too.

The site also runs inside an Android wrapper app, bundled and offline: no
absolute paths, a silent fallback when there's no service worker, and a
native share/theme bridge when the wrapper is present.

## Run it locally

```
git clone https://github.com/munzzyy/puzzlepress
cd puzzlepress
python3 -m http.server
```

Open http://localhost:8000. Any static file server works. The site also
installs as a PWA and keeps working offline once you have visited it.

## Android

[`android/`](android) wraps the same site in a small WebView app that
bundles every page and puzzle bank, with no internet permission at all.
Share opens the system share sheet, and Back closes an open dialog before
it leaves a game. Signed APKs are on the
[releases page](https://github.com/munzzyy/puzzlepress/releases), and
[Tern](https://tern.munzzyy.dev) keeps it up to date from those releases.
To build it yourself, run `./gradlew assembleDebug` inside `android/`.

[<img src="https://tern.munzzyy.dev/badge.png" alt="Get it with Tern" height="80">](https://tern.munzzyy.dev/add/?url=https%3A%2F%2Fgithub.com%2Fmunzzyy%2Fpuzzlepress)

## How the dailies work

Each game ships with a committed bank of puzzles in `data/`. Your browser
picks today's puzzle by counting days since the launch date and taking that
index into the bank, wrapping around when it runs out. Same date, same puzzle,
everywhere, with no server involved. The day flips at your local midnight,
the same moment your saved progress and streaks roll over.

Fair warning: the banks are plain JSON in a public repo, so today's answers
are one file away. Peeking only ruins your own streak.

Missed a day, or just want to replay one? [archive.html](archive.html) (linked
from the hub as "Play a past day") lists every past day for every game back
to launch. Opening one loads that day's puzzle with a banner reminding you
it is not today's and a link back. Its progress is saved under that specific
date, so replaying an old day can never overwrite today's puzzle or touch
your streak.

## Regenerating the banks

Each `tools/gen_<game>.py` rebuilds its `data/<game>.json`. They are stdlib
Python, deterministic with `--seed`, and validate their own output before
writing anything. You should not need to run them unless you want a different
bank.

## Tests

```
node --test assets/shared.test.mjs games/*/core.test.mjs tests/sw.test.mjs
python3 -m pytest -q
```

The node suites cover game logic (all of it lives in `games/<id>/core.js`
with no DOM in sight) and how the service worker matches cached pages. The
pytest suites check every bank against its schema and invariants: sudoku
uniqueness, wordweave grids tiling fully, minigrid clues matching their
answers, and so on. `test_bank_history.py` pins every bank's pre-growth
prefix and every entry that shipped in 1.0.0 by hash, so a growth pass can
only append.

A handful of those pytest cases regenerate a bank in a subprocess against
the full word list to prove the generator is deterministic, which is what
makes the full run take a couple of minutes. For a fast local loop while
you're working on anything that is not a generator, skip them:

```
python3 -m pytest -q -m "not slow"
```

CI always runs the full suite, slow tests included.

## Honest limits

- Word "commonness" is judgment plus one data point. Wordrow's easy and hard
  answer tiers were ranked against Peter Norvig's public word frequency
  counts in a one time offline pass, then read word by word to drop proper
  nouns, brands and slang; nothing from that corpus ships or runs here. The
  other curated lists are hand picked, and the full guess dictionaries come
  straight from the public domain ENABLE list, which accepts words like
  ZOEAE. The occasional obscure but valid word will show up.
- The big dictionaries accept some words that don't belong in a family
  puzzle. [`assets/blocklist.js`](assets/blocklist.js) lists them, and the
  games drop them at play time: Heptagram never accepts, counts, hints or
  reveals one, Wordweave never takes one as a bonus word, and Wordrow and
  Edgeways won't take one as a guess. The same list keeps the generators
  from picking them, and the curated answer lists are clean. The list is
  kept by hand, so it will miss the odd word.
- Sudoku's hard tier is one wide bucket, graded by solving technique rather
  than a full named-technique ladder. Some hard days are harder than others.
- Minigrid uses two block layouts across its bank. The other valid 5x5
  shapes produced no clean fills from the curated vocabulary, so they are
  not in there. Hard puzzles are picked for trickier entries and reclued
  where a trickier clue exists, but some of their clues still read like
  medium ones.
- Bank sizes, easy/medium/hard, counted from the August 10, 2026 launch:
  Clusters, Sudoku and Heptagram are 365/365/365, a full year before any
  repeat. Wordweave is 201/200/200, good until late February 2027. Minigrid
  is 200/148/200: its medium tier is whatever fills are left after easy and
  hard take theirs, and the curated vocabulary runs out first, so medium
  repeats from January 5, 2027. Edgeways is 365/268/365, so only its medium
  tier repeats inside the first year, from May 5, 2027. Wordrow's
  answer pools are 301/795/245, and its guess dictionary is separate and
  much larger. A repeat is the same puzzle as its earlier day, not a broken
  one.
- Sudoku cells land around 38-40px on a 360-390px phone, under the 44px
  touch guideline. Nine cells across a small screen leaves no way around it,
  so the toolbar's zoom button grows the board past its wrapper instead:
  cells clear 44px and you scroll to reach every corner. Every other
  control is 44px or better without needing it.
- Wordrow's on-screen keyboard keys run about 33-37px wide (46px tall) on a
  390px phone. Ten keys across the top row just don't fit at 44px each on a
  phone screen; a physical keyboard has no such limit, and every key is
  wired to a real key press.
- Day numbering starts at the launch date, so the archive is only as old as
  the site: there is nothing to replay from before launch.

## Roadmap

What is left needs a release, a store review or a decision. None of it is code.

- Android 1.0.3. Everything under Unreleased in the
  [changelog](CHANGELOG.md) reaches the website when it deploys, but the
  app only gets it through a signed release. That release is not cut yet.
  The backup fix for Android 7 to 11 is app-only, so it waits on this too.
- F-Droid. The app is submitted
  ([fdroiddata!50148](https://gitlab.com/fdroid/fdroiddata/-/merge_requests/50148))
  and waiting on review. Until it is in, use the releases page or Tern.
- Whether streaks belong in Android's cloud backup. The app lets Android
  copy its saved progress into the phone's own backup, which is also how
  it moves to a new phone, but the store listing says your streaks live on
  your phone and nowhere else. One of those has to change, and which one
  is still an open call.

## Support

If you want to help keep Puzzle Press going, you can sponsor on [GitHub Sponsors](https://github.com/sponsors/munzzyy) or send Monero to:

```
8BApLkfsBS39oNXz4L1qCmZ7f5zKVRr1qLJgrHddRZb4JRcnjDkcKdk7wW7uThCeV9CuLn8o7gAn8d6vFeWNiyeXSmrRUSq
```

## License

[GPL-3.0-or-later](LICENSE). You can play it, study it, change it and share
it. If you share a copy or a modified version, it has to stay under the GPL
and come with its source. Commits before the 1.0.0 release were under the
Prosperity Public License 3.0.0.

The word list is the public domain ENABLE list; sources are recorded in
[data/ATTRIBUTION.md](data/ATTRIBUTION.md).
