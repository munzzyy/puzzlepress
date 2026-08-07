#!/usr/bin/env python3
"""Builds data/wordrow.json from data/wordlist.txt. Stdlib only.

The answer pool is a hand-curated list of common, everyday 5-letter English
words (curation is the point of this game: nobody wants "aahed" as a daily
answer). The allowed pool is every valid 5-letter word in wordlist.txt, so
players can guess widely even though only common words ever get chosen as
the day's answer.

Run: python3 tools/gen_wordrow.py [--seed N] [--out path]
"""

import argparse
import json
import os
import random
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDLIST_PATH = os.path.join(ROOT, "data", "wordlist.txt")
DEFAULT_OUT = os.path.join(ROOT, "data", "wordrow.json")
DEFAULT_SEED = 20260810  # the launch epoch, just a stable arbitrary default

WORD_RE = re.compile(r"^[a-z]{5}$")

# Best-effort filter, applied to both pools. Answers are separately reviewed
# by hand below and contain none of these; this exists as a safety net over
# the much larger inherited wordlist.txt allowed pool.
PROFANITY_BLOCKLIST = {
    "bitch", "whore", "cunts", "fucks", "wanks", "twats", "skank", "squaw",
    "spick", "shits",
}

# Hand-curated common 5-letter words. Ordinary vocabulary a daily player
# already knows, not obscure Scrabble fodder. This is the quality bar the
# contract asks for: every one of these should feel fair as a daily answer.
CURATED_ANSWERS = """
    about above abuse actor acute admit adopt adult after again agent agree
    ahead alarm album alert alien align alike alive allow alloy alone along
    aloud alter amber amend among ample angel anger angle angry apart apple
    apply arena argue arise armor aroma array arrow aside asset avoid awake
    award aware badge baker basic basin basis batch beach beast begin being
    belly below bench berry birth black blade blame blank blast blaze bleed
    blend bless blind block blood bloom blues blunt blush board boast bonus
    boost booth bound brain brand brass brave bread break breed brick bride
    brief bring broad broke brook broom brown brush build built bunch burst
    cabin cable candy canoe carry carve catch cause chain chair chalk charm
    chart chase cheap check cheer chest chief child chill chunk cider civic
    civil claim clash class clean clear clerk click cliff climb cling clock
    close cloth cloud clown coach coast could count court cover craft crane
    crash crazy cream creek crept crest crime crisp cross crowd crown crude
    cruel crush curve cycle daily dairy dance dealt death debut decay delay
    delta denim depth diary dirty ditch dizzy donor doubt dough dozen draft
    drain drama drawn dread dream dress dried drift drink drive drown eager
    eagle early earth eight elbow elder elite empty enemy enjoy enter entry
    equal error erupt essay event every exact exert exile exist extra fable
    faith false fancy fault favor feast fence fetch fewer fiber field fifth
    fifty fight final first fixed flame flash fleet flesh flick float flock
    flood floor flour flown fluid flush focus force forge forth forty forum
    found frame fresh front frost fruit fully funny gauge ghost giant given
    glass gleam glide globe glory glove going grace grade grain grand grant
    grape graph grasp grass grave great greed green greet grief grill grind
    gross group grove grown guard guess guest guide habit happy harsh haste
    hatch haven heart heavy hedge hello hence herbs hobby hoist honey honor
    horse hotel house human humor hurry ideal image imply index inner input
    inter issue ivory jelly joint joker jolly judge juice jumbo jumpy karma
    kneel knife knock known label labor laden large laser latch later laugh
    layer learn least legal lemon level light limit linen lodge logic loose
    lorry loyal lucky lunar lunch lying magic major maker mango march marsh
    match maybe mayor medal media melon mercy merge merit metal meter might
    mimic minor minus mixed model mogul moist money month moral motor mount
    mouse mouth movie music naive naked nasty nerve never newly night noble
    noise north notch novel nurse nylon offer often olive onion opera orbit
    order organ other ought outer owner oxide paint panel panic paper party
    patch pause peace pearl phase phone photo piano piece pilot pitch pizza
    place plaid plain plane plant plate pluck plumb plush point poise polar
    porch pouch pound power press price pride prime print prior prize probe
    proof proud prove proxy pulse punch pupil purse queen query quest quick
    quiet quilt quirk quite quota radar radio raise ranch range rapid ratio
    reach ready realm rebel refer reign relax repay reply reset rhyme rider
    ridge rigid rinse risen risky rival river roast robot rocky rogue roost
    round route royal rugby ruler rural salad salsa sandy sauce scale scarf
    scent scoop scope score scout scrap screw seize sense serve setup seven
    shade shaft shake shall shame shape share shark sharp shave shear sheep
    sheer sheet shelf shell shift shine shiny shirt shock shore short shout
    shown shrub siege sight silly since sixty skill skirt slate sleep slice
    slide slope small smart smell smile smoke snack solid solve sonic sound
    south space spare spark speak speed spell spend spent spice spine spite
    split spoil spoke spoon sport spray spree spurt squad stack staff stage
    stain stake stalk stall stamp stand stare start state stead steak steal
    steam steel steep stern stick stiff still sting stock stole stomp stone
    stood stool story stove strap straw stray strip stuck study stuff style
    suede sugar suite sunny super surge sushi swamp swarm swear sweat sweep
    sweet swift swing swirl sword table taken taste teach thank theft theme
    there thick thief thing think third thorn those threw throw thumb thump
    tidal tiger tight timer tired title toast today token tonal tonic torch
    touch tough tower toxic trace track trade trail train trait tramp trash
    tread treat trend trial tribe trick tried truck truly trust truth tulip
    tummy tumor tunic twist twice under union unite unity until upper upset
    urban usage usual utter vague valid value vapor vault vegan venue verse
    video vinyl viral virus visit vital vivid vocal voice voter waist waste
    watch water wharf wheat wheel while white whole whose widen width wince
    winds windy witch women world worry worst worth would wound woven wrist
    write wrong yield young youth zebra
""".split()


def load_wordlist(path):
    """Returns (five_letter_words, all_words). The plural check needs the
    full list since a five-letter plural's base is usually four letters."""
    five = set()
    everything = set()
    with open(path, encoding="utf-8") as f:
        for line in f:
            w = line.strip().lower()
            if not w:
                continue
            everything.add(w)
            if WORD_RE.match(w):
                five.add(w)
    return five, everything


def is_simple_plural(word, all_words):
    """True if `word` is just a shorter dictionary word plus a trailing s,
    the kind of flat plural the contract asks answers to avoid."""
    if not word.endswith("s"):
        return False
    base = word[:-1]
    return len(base) >= 3 and not base.endswith("s") and base in all_words


def build_bank(wordset, all_words, seed):
    curated = sorted(set(CURATED_ANSWERS))

    missing = [w for w in curated if w not in wordset]
    if missing:
        raise ValueError(f"curated answers not found in wordlist.txt: {missing}")

    answers = [
        w for w in curated
        if not is_simple_plural(w, all_words) and w not in PROFANITY_BLOCKLIST
    ]

    allowed = sorted((wordset | set(answers)) - PROFANITY_BLOCKLIST)

    rng = random.Random(seed)
    rng.shuffle(answers)

    return {"answers": answers, "allowed": allowed}


def validate(bank, all_words):
    errors = []

    if "answers" not in bank or "allowed" not in bank:
        errors.append("bank is missing 'answers' or 'allowed'")
        return errors

    answers = bank["answers"]
    allowed = bank["allowed"]
    allowed_set = set(allowed)

    if len(answers) < 500:
        errors.append(f"answers has {len(answers)} entries, need >= 500")

    if len(set(answers)) != len(answers):
        errors.append("answers contains duplicates")

    if len(set(allowed)) != len(allowed):
        errors.append("allowed contains duplicates")

    if allowed != sorted(allowed):
        errors.append("allowed is not sorted")

    for w in answers:
        if not WORD_RE.match(w):
            errors.append(f"answer '{w}' is not 5 lowercase letters")
        if w not in allowed_set:
            errors.append(f"answer '{w}' is missing from allowed")
        if is_simple_plural(w, all_words):
            errors.append(f"answer '{w}' is a simple plural")
        if w in PROFANITY_BLOCKLIST:
            errors.append(f"answer '{w}' is blocklisted")

    for w in allowed:
        if not WORD_RE.match(w):
            errors.append(f"allowed entry '{w}' is not 5 lowercase letters")
        if w in PROFANITY_BLOCKLIST:
            errors.append(f"allowed entry '{w}' is blocklisted")

    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--wordlist", default=WORDLIST_PATH)
    args = parser.parse_args()

    wordset, all_words = load_wordlist(args.wordlist)
    bank = build_bank(wordset, all_words, args.seed)

    errors = validate(bank, all_words)
    if errors:
        for e in errors:
            print(f"INVALID: {e}")
        raise SystemExit(1)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(bank, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")

    print(f"wrote {args.out}: {len(bank['answers'])} answers, {len(bank['allowed'])} allowed words")


if __name__ == "__main__":
    main()
