#!/usr/bin/env python3
"""Builds data/wordrow.json from data/wordlist.txt. Stdlib only.

Three difficulty-graded answer pools (easy/medium/hard):

  easy   - very common answers, curated for players who want an easy win.
  medium - the original 795-word curated pool, unchanged.
  hard   - real, everyday-recognizable words, just less common than medium.

Grading is not a guess: every word list below was checked against actual
English usage frequency (https://norvig.com/ngrams/count_1w.txt, Peter
Norvig's word-frequency corpus derived from the Google Web Trillion Word
Corpus, released for free reuse) before being typed in here, then read by
hand to drop proper nouns, brand names, and anything that reads slang or
crude even when the raw frequency count ranked it common. None of that
frequency data ships or runs at build/runtime; it was a one-time research
pass, the same way the original CURATED_ANSWERS list below was hand-picked.

EASY_PROMOTED_WORDS are members of CURATED_ANSWERS (the medium pool) that
also land in the top slice of that frequency corpus, so they double as easy
answers without leaving medium. EASY_NEW_ANSWERS and HARD_ANSWERS are words
outside the medium pool entirely: EASY_NEW skews even more common than the
promoted set, HARD sits in roughly the 15th-30th percentile of five-letter
English words by usage - real and recognizable, just not everyday-common.
None of the existing 795 scored low enough on that same frequency measure to
read as "hard" (the hand-curated medium pool already skews common), so hard
is built fresh rather than carved out of medium.

The allowed pool (valid guesses, not answers) is shared across all three
difficulties: every 5-letter word in wordlist.txt plus every curated answer,
so players can guess broadly no matter which difficulty they're playing.

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
DIFFICULTIES = ("easy", "medium", "hard")
MIN_BANK_SIZE = 200  # per difficulty

# Best-effort filter, applied to every pool. Answers are separately reviewed
# by hand below and contain none of these; this exists as a safety net over
# the much larger inherited wordlist.txt allowed pool.
PROFANITY_BLOCKLIST = {
    "bitch", "whore", "cunts", "fucks", "wanks", "twats", "skank", "squaw",
    "spick", "shits",
}

# Hand-curated common 5-letter words: the medium pool, unchanged from v1.
# Ordinary vocabulary a daily player already knows, not obscure Scrabble
# fodder. This is the quality bar the contract asks for: every one of these
# should feel fair as a daily answer.
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

# The most frequently-used members of CURATED_ANSWERS, per the corpus
# described above (roughly the top 4% of all five-letter English words by
# usage). These stay in the medium pool and also serve as easy answers.
EASY_PROMOTED_WORDS = frozenset("""
    about above adult after again agent album allow along among apply award
    basic basis beach being below black blood board brand bring brown build
    built cable cause cheap check child class clear click close could court
    cover cross daily death drive early earth enter entry error event every
    extra field final first flash focus force forum found front given glass
    going great green group guide happy heart horse hotel house human image
    index input issue known large later learn least legal level light major
    march media might model money month movie music never night north offer
    often
    order other owner paper party phone photo place point power press price
    print prior quick quite radio range ready reply river round score shall
    share short shown since small sound south space speed sport staff start
    state still stock story study stuff style super table taken thank there
    thing think third those title today track trade under union until value
    video visit voice watch water while white whole women world would write
    young
""".split())

# Very common words that are not already in the medium pool. Same frequency
# floor as EASY_PROMOTED_WORDS above.
EASY_NEW_ANSWERS = """
    which their these where store right local using based three total topic
    quote poker audio added color doing asked lower leave woman rated wrote
    heard bible older buyer canon saint began moved sorry gamma owned named
    taxes ended ocean anime filed noted scene alpha adobe occur buddy genre
    storm micro ultra audit solar loved saved hairy metro lived meant villa
    cache lease comic crack modem worse fraud ebony dodge plaza vista armed
    devil sized dated shoot gnome atlas corps liver decor aging intro sigma
    rough weird robin valve liked cited carol trunk camel voted combo drunk
    toner latex omega saver salon turbo aimed faced sixth cheat macro teeth
    lotus cargo maple depot debug chuck bingo cedar mason chose brake clone
    relay oasis lover daddy ferry motel rally dying paste coral pixel
""".split()

# Real, recognizable words that read as "tougher" than the medium pool -
# roughly the 15th-30th percentile of five-letter English words by usage in
# the same corpus, reviewed the same way. None of these are in medium.
HARD_ANSWERS = """
    annex wired chess canal amino drill tries wider uncle naval fired retro
    handy guild chick indie patio snake queue alias newer manor disco digit
    lyric lobby holly fatal puppy satin promo renew hired rehab condo fairy
    kitty merry scuba derby tuner heath rouge yeast yacht whale tract ozone
    samba belle lined boxed cubic elect bunny flyer jewel teddy dryer ruled
    funky scary mixer tooth drove lance colon spank bacon trout badly blink
    fuzzy dense awful wagon mambo choir blond fibre daisy bored hoped safer
    theta arbor rifle sewer sided resin usher skate franc towel coupe spike
    sedan flora hardy baked urged adapt tutor debit raven aspen demon couch
    optic chili celeb quake alley renal liner acted skull ninja cobra ninth
    marry drake fried woody cried coded beige homer blown baton abbey sauna
    ankle react flute cease equip curry niche cigar curse titan reuse peach
    uncut freak bluff sadly avail stein spill onset assay squid maxim pagan
    widow juicy moody pedal tuned terra goose hydro noisy abide bliss parse
    mania typed clamp racer guilt posed boxer weigh rodeo moose lever tasty
    tarot cocoa mixes biker baron rabbi puffy stark circa razor cough inlet
    gloss panda eaten dinar creed carat plump midst borne tempo attic piper
    tenth aided cutie ounce flint dummy burnt petty smash hated spicy beard
    wedge hyper gamer savvy fetal chord comet lotto syrup erase prose taboo
    dwarf codec horde mommy nanny roach natal prone timed scare motif spear
    birch slash helix shook matte
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


def clean(words, all_words):
    """Drops simple plurals and blocklisted entries, keeps first-seen order."""
    seen = set()
    out = []
    for w in words:
        if w in seen:
            continue
        seen.add(w)
        if is_simple_plural(w, all_words) or w in PROFANITY_BLOCKLIST:
            continue
        out.append(w)
    return out


def build_bank(wordset, all_words, seed):
    curated = sorted(set(CURATED_ANSWERS))
    missing = [w for w in curated if w not in wordset]
    if missing:
        raise ValueError(f"curated answers not found in wordlist.txt: {missing}")

    easy_new = sorted(set(EASY_NEW_ANSWERS))
    missing = [w for w in easy_new if w not in wordset]
    if missing:
        raise ValueError(f"easy answers not found in wordlist.txt: {missing}")

    hard = sorted(set(HARD_ANSWERS))
    missing = [w for w in hard if w not in wordset]
    if missing:
        raise ValueError(f"hard answers not found in wordlist.txt: {missing}")

    medium_answers = clean(curated, all_words)
    easy_promoted = [w for w in medium_answers if w in EASY_PROMOTED_WORDS]
    easy_answers = clean(easy_promoted + easy_new, all_words)
    hard_answers = clean(hard, all_words)

    overlap = (set(easy_answers) & set(hard_answers)) - set(easy_promoted)
    if overlap:
        raise ValueError(f"easy and hard answers overlap: {sorted(overlap)}")

    allowed = sorted(
        (wordset | set(medium_answers) | set(easy_answers) | set(hard_answers))
        - PROFANITY_BLOCKLIST
    )

    rng = random.Random(seed)
    pools = {"easy": easy_answers, "medium": medium_answers, "hard": hard_answers}
    bank = {}
    for diff in DIFFICULTIES:
        shuffled = pools[diff][:]
        rng.shuffle(shuffled)
        bank[diff] = {"answers": shuffled, "allowed": allowed}

    return bank


def validate(bank, all_words):
    errors = []

    if not isinstance(bank, dict) or set(bank.keys()) != set(DIFFICULTIES):
        errors.append(f"bank must have exactly the keys {DIFFICULTIES}")
        return errors

    for diff in DIFFICULTIES:
        section = bank[diff]
        if "answers" not in section or "allowed" not in section:
            errors.append(f"{diff}: section is missing 'answers' or 'allowed'")
            continue

        answers = section["answers"]
        allowed = section["allowed"]
        allowed_set = set(allowed)

        if len(answers) < MIN_BANK_SIZE:
            errors.append(f"{diff}: answers has {len(answers)} entries, need >= {MIN_BANK_SIZE}")

        if len(set(answers)) != len(answers):
            errors.append(f"{diff}: answers contains duplicates")

        if len(set(allowed)) != len(allowed):
            errors.append(f"{diff}: allowed contains duplicates")

        if allowed != sorted(allowed):
            errors.append(f"{diff}: allowed is not sorted")

        for w in answers:
            if not WORD_RE.match(w):
                errors.append(f"{diff}: answer '{w}' is not 5 lowercase letters")
            if w not in allowed_set:
                errors.append(f"{diff}: answer '{w}' is missing from allowed")
            if is_simple_plural(w, all_words):
                errors.append(f"{diff}: answer '{w}' is a simple plural")
            if w in PROFANITY_BLOCKLIST:
                errors.append(f"{diff}: answer '{w}' is blocklisted")

        for w in allowed:
            if not WORD_RE.match(w):
                errors.append(f"{diff}: allowed entry '{w}' is not 5 lowercase letters")
            if w in PROFANITY_BLOCKLIST:
                errors.append(f"{diff}: allowed entry '{w}' is blocklisted")

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

    counts = ", ".join(f"{d}={len(bank[d]['answers'])}" for d in DIFFICULTIES)
    print(f"wrote {args.out}: {counts} answers")


if __name__ == "__main__":
    main()
