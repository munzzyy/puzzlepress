#!/usr/bin/env python3
"""
Generates data/edgeways.json: three difficulty-graded banks of Edgeways
puzzles (easy, medium, hard).

Each puzzle is a square of twelve letters, three per side, solved by a
chain of words (each starting where the last one ended) whose combined
letters cover the board exactly. The sides are not chosen first: we pick a
chaining word (or word pair, for hard) from the shared word list, then
search for a way to split the combined letters into four groups of three
such that no two letters that ever sit next to each other in any solution
word land on the same side. That search is what actually proves the
solution works, so "par" is never a guess.

Difficulty semantics (V2-CONTRACT.md):
  easy   - par 3 (a three-word solution chain), common letters only: no
           J, Q, X, or Z on the board, so every letter is an easy reach.
  medium - par 2 (a two-word solution chain), the original bank shape.
  hard   - par 2, but the board always carries at least one of J/Q/X/Z.

Also writes games/edgeways/words.json: the runtime dictionary game.js uses
to validate any word a player tries, not just the committed solution words.

Usage: python3 tools/gen_edgeways.py [--seed N] [--grow-to N | --dictionary-only]
"""
import argparse
import json
import random
import re
import sys
from pathlib import Path

from blocklist import BLOCKED_WORDS

ROOT = Path(__file__).resolve().parent.parent
WORDLIST_PATH = ROOT / "data" / "wordlist.txt"
BANK_PATH = ROOT / "data" / "edgeways.json"
DICTIONARY_PATH = ROOT / "games" / "edgeways" / "words.json"

MIN_BANK_SIZE = 80  # per difficulty, per V2-CONTRACT.md

# Target puzzle counts per difficulty. Hard is capped lower and given a
# looser reuse cap below because it draws from a much smaller pool: only
# words that carry a J, Q, X, or Z. Easy and medium draw from the full
# common-word pool.
TARGET_COUNTS = {"easy": 100, "medium": 140, "hard": 90}
MAX_REUSE = {"easy": 3, "medium": 3, "hard": 6}

RARE_LETTERS = set("JQXZ")

# Candidate solution words: kept to lengths that read naturally and stay
# clear of the more obscure corners of the word list.
SOLUTION_MIN_LEN = 4
SOLUTION_MAX_LEN = 10

# Solution words are drawn from this curated pool of everyday English
# words rather than the full word list, which is comprehensive but full of
# competitive-Scrabble obscurities (ACMATIC, CHIBOUKS, BAIZAS...). The
# runtime dictionary below still uses the full word list, so players can
# type any real word, but the word shown as "the" solution should read
# like something a person would actually say. Every entry here is checked
# against the word list at load time so a typo can't sneak a non-word in.
COMMON_WORDS = """
able about above acid acre across actor address adult after again agent agree ahead aide
airport alarm album alert alike alive allow almost alone along aloud already also alter always
amaze amber amount ample amuse angel anger angle angry animal ankle annoy answer apart apple
apply area argue arise army around arrow artist aside asleep aspect assert asset assist assume
atom attach attack attend attic aunt author auto avoid await awake award aware away awful axis
baby back bacon badge badly bake baker balance bald ball band bank bare bark barn barrel base
basic basin basis basket bath battle beach bead beam bean bear beard beast beat beauty beef
been before begin behind being belief bell belly belong below belt bench bend beside best
better between beyond bias bible bike bill bind bird birth bishop bison bite bitter black blade
blame blank blast blaze bleak bleed blend bless blind blink block blond blood bloom blot blow
blue bluff blunt blur board boast boat body boil bold bolt bomb bond bone bonus book boost boot
booth border born borrow boss both bother bottle bottom bought bound bowl boxer brace brain
brake branch brand brass brave bread break breed brick bride brief bring broad broke bronze
broom brown brush buck budge budget buffer bugle build built bulb bulk bull bump bunch bundle
burn burst bury bush busy butter buyer cabin cable cage cake calf call calm came camel camp
canal candy cane canoe canyon cape card care cargo carol carry cart carve case cash cast castle
catch cause cave cease chain chair chalk champ chance change chant chaos charm chart chase
cheap cheat check cheer chess chest chief child chill chin chip choice choir choke chore chose
chunk cider cinch circle claim clamp clan clap class claw clay clean clear clerk click cliff
climb cling clip cloak clock close cloth cloud clown club clue coach coal coast coat cocoa code
coil coin cold color colt column combo come comet comic coral cord core corn cost couch cough
could count court cover crab craft crane crash crawl crazy cream creek crew crime crisp cross
crowd crown crude cruel crush crust cube cure curl curse curve cycle daily dairy dance dandy
dared dark dash data date dawn dead deaf deal dear debt debut decay decide deck deed deep deer
defer delay delta demon dense dent depth desk devil diary dice dine dirt dish disk ditch dive
dock does doll dome donor door dose doubt dough dove down dozen draft drag drain drama drank
draw dream dress drift drill drink drive drop drove drum duck duke dull duly dust duty each
eager eagle early earn earth ease east easy echo edge edit eight elbow elder elect elite else
empty enemy enjoy enter entry envy equal equip erase error essay even event every evil exact
exam excel exist exit expand extra eyes fable face fact fade fail faint fair fake fall false
fame fancy fast fate fault favor fear feast feed feel fence fetch fever fewer field fifth fifty
fight file fill film final find fine fire firm first fish fist five fixed flag flame flash flat
flee fleet flesh flex flick fling flock flood floor flour flow fluid flush foam focus foggy
fold folk food foot force forge forth forty forum found four fowl frame frank fraud freak fresh
friar fried frost frown fruit fuel full fully fund funny fury fuse gain gala gallon game garden
gate gather gauge gave gaze gear geese gene ghost giant gift girl give glad glance glass glaze
gleam glide glory glove glow glue goal goat gold golf gone good goods goose gospel gown grab
grace grade grain grand grant grape graph grasp grass grave gravy gray great greed green greet
grid grief grill grim grind grip groom group grove grow guard guess guest guide guild guilt
gust gutter habit hair half hall halt hammer hand handy hang happy harbor hard harm harp harsh
harvest haste hasty hatch hate haul haunt haven hawk hazard haze head heal heap hear heart heat
heavy hedge heel height helix hello helmet help hence herb herd here hero hers hide high hike
hill hint hire hiss history hive hobby hold hole holy home honey honor hoof hook hope horn
horse hose host hotel hound hour house howl huge hull human humble humor hundred hunger hunt
hurl hurry hurt hush husk husky hybrid icon idea ideal idle image imply inch index inner input
inside intact into inward iris iron issue item ivory jacket jade jail jazz jealous jeep jelly
jerky jewel join joint joke jolly jolt judge juice jumble jump jungle junior junk jury just
kayak keel keen keep kelp kept kettle kick kidney kind king kiss kitchen kite kitten knack knee
kneel knew knife knight knit knock knot know label labor lace lack lady lake lamb lame lamp
land lane large lark laser last latch late later laugh launch laurel lava lawn layer lead leaf
leak lean leap learn lease least leave ledge left legal lemon lend lens lent letter level lever
liar life lift light like limb lime limit line link lion list live load loan lobby local lock
lodge loft logic lone long look loop loose lord lose loss lost loud lounge love lower loyal
luck lump lunar lunch lung lure lush lust lynx magic maid mail main major make male mall mango
manor many maple march marine mark market marry marsh mask mason mass mast match mate math maze
meal mean meant meat medal media melt memo mend mercy merge merit merry mesh mess metal meter
method micro midst might mild mile milk mill mimic mind mine mint minus minute mirror miser
miss mist model modem mold molt momma monk month moody moon moral more morning moss most motel
moth motor mount mouse mouth move movie mower much muffin mule mummy mural music must muted
myth nail naked name nanny narrow nasty nation native navy near neat neck needle negate nerve
nest never news next nice niece night nine noble noise noon norm north nose note noun novel
novice noxious nozzle numb number nurse oath obey oblige occur ocean offer often ogre olive
omit once onion only onto onward opal open opera orbit order organ other otter ounce outer
output oval oven over owner oxide oyster pace pack page paid pail pain paint pair palace pale
palm panel panic pants paper parade pardon parent parish park part party pass past patch path
pause peace peach peak pearl pedal peel peer pelt pencil penny people pepper perch perk permit
petal petty phase phone photo piano pick piece pier pile pilot pinch pine pink pint pipe pirate
pitch pity pixel place plaid plain plan plant plate play plaza plead please pledge plod plot
plow pluck plug plum plus poach poem point poise poke polar pole polish pond pony pool poor
porch pork port pose posh post pouch pound pour power praise prawn pray prefer press prey price
pride prime print prior prism prize probe promo prone proof prose proud prove prowl prune pulse
pump punch pupil puppy purge purple purse push putt quack quaint quake qualm quart queen query
quest quick quiet quilt quirk quit quite quota quote rabbit race radar radio raft rage raid
rail rain raise ralph ranch range rank rapid rare rarely rash rate ratio raven reach react
ready realm rear rebel recall recap recipe reckon record reed reef refer relax relay relic rely
remit renew rent repay reply rerun reset resin resort rest retro return reveal rhino rhyme rice
rich ride ridge rifle right rigid rigor rinse ripe risk rite ritual rival river road roam roar
roast robe robin robot rock rocky rogue role roll roman roof room root rope rose rosy rough
round route royal ruby rugby ruin rule runoff rural rust sable sack sacred sadly safe saga sail
saint salad salmon salon salt salute same sample sand satin sauce save savor scale scalp scan
scarf scary scene scent scoop scope score scout scowl scrap screen screw scribe scroll scrub
scuba seal seam search season seat second secret sector seed seek seem segment seize senior
sense sent series serve setup seven sever sewer shack shade shady shaft shake shall shame shape
share shark sharp shave shed sheep sheet shell shelter shift shine shiny ship shirt shock shoe
shone shook shop shore short shout shove show shred shrewd shrimp shrine shrub shrug shuffle
shun shut sick side siege sigh sight sign silent silk silly silver simple since sinful sing
single sink siren sister site size skate sketch skill skin skip skirt skull slab slack slam
slap slate slave sleek sleep sleet sleeve slice slide slight slim sling slip slit slogan slope
slot sloth slow slug slum slush small smart smash smell smile smoke smooth snack snail snake
snap sneak sneer sniff snore snort snout snow soak soap sober social sock soda sofa soft soil
solar solid solve some song sonic sonny soot sorry sort soul sound soup sour south spade span
spare spark spawn speak spear speed spell spend spent spice spike spill spine spiral spirit
spit splash spoke sponge spoof spool spoon sport spot spouse spout spray spread spree spring
sprint sprout spruce spry spunk spur squad square squash squat squid stable stack staff stage
stain stair stake stale stalk stall stamp stand staple star stark start state stay steady steak
steal steam steed steel steep steer stem step stern stew stick stiff still sting stock stole
stomp stone stood stool stop store storm story stout stove strap straw stray strip strong stuck
study stuff stump stun sturdy style sugar suit sulfur summit sunny super surf surge swamp swan
swarm swear sweat sweep sweet swell swift swim swing swirl swoop sworn syrup table taco tail
take tale talk tall tame tank tape target task taste taunt taxi teach team tear tease teeth
tell temper tempo tempt tenant tend tenor tense tent term test text thank theft theme there
thick thief thigh thing think third thorn those thread threat throat throne throw thumb thump
thunder tidal tide tiger tight tile timber time tiny tired title toast today toil token told
toll tomato tone tongue tonic took tool tooth topic torch torn total touch tough tour toward
tower town toxic trace track trade trail train trait trance transit trap trash treat tree trend
trial tribe trick trip tropic trout truce truck trunk trust truth tube tulip tummy tune tunnel
turbo turf turkey turn tusk tutor twelve twice twig twin twist tycoon ultra uncle under undo
union unit unite unity until unto upon upper urban urge usage user usher usual utter vague
valid valley value valve vapor vast vault vein velvet venom venue verb verse vessel vest vice
video view vigor villa vine vintage viral virus visa visit vital vivid vocal voice void volt
vote vowel voyage wage wagon waist wait wake walk wall waltz wander want warm warn warp wash
waste watch water wave waver wavy weak wealth weapon wear weary weave wedge weed week weigh
weird well went were west whale wharf wheat wheel where which while whim whip whirl white whole
whom whose widen widow width wield wife wild will willow wince wind wine wing wink winter wipe
wire wise wish wisp witch with witty wolf woman wonder wood wool word world worry worse worst
worth would wound woven wrap wrath wreck wrist write wrong yacht yard yarn yawn year yeast yell
yellow yield yoga young youth zebra zero zesty zone
adventure afternoon alphabet basketball beautiful breakfast building butterfly calendar
celebrate chemistry chocolate community computer curious dangerous daughter delicious
dinosaur direction discovery education elephant engineer exercise expensive fantastic
favorite festival furniture generous geography helicopter highlight hospital identify
important including increase industry initial interest internal jellyfish kangaroo keyboard
landscape language lifetime literary magazine marriage material maximum meaning meantime
measure medicine memorial merchant minimum mistake moisture monitor mortgage mountain
mushroom mysterious narrative national negative neighbor network notebook nowadays
numerous obstacle official operator opposite optimism orchestra organize original overcome
overlook overseas overtime painting pandemic paradise parallel particle passenger pastoral
peaceful pedigree penalty perceive percent perfect perhaps perimeter permanent persuade
physical pipeline plastic platform playground pleasant pollution portable possible potatoes
powerful pressure primary printer priority privacy probably problem produce product profile
program project promise property proposal prospect protocol provide publisher purchase
pursuit qualify quantity radiation railroad rainbow reaction realistic receiver recovery
reflect regional register relative relevant reliable religion remember reminder republic
resemble resident resource respected response restaurant restrict retrieve revenue reverse
ridiculous romantic sandwich scenario schedule scholar scientist sculpture seafood seasonal
secondary section sentence separate sequence session shoulder signature similar situation
skeleton solution somebody somewhat specific spectrum standard statement strategy
strawberry strength struggle subject substance succeed suggest summary sunshine supplies
support surface surprise surround survival syndrome talented tangible technique telephone
telescope television terminal territory therefore thousand together tomorrow tonight
tourism tradition transfer treasure tremendous triangle tropical trouble tsunami typical
umbrella understand undertake universe upstairs vacation valuable variable vegetable vehicle
version veteran village violence visible visitor vitamin volcano voluntary warranty
waterfall watermelon weekend welcome whatever whenever wherever whisper wildlife wireless
withdraw without witness wonderful worksheet workshop
frozen wizard lizard zigzag zombie blazer frenzy gazebo horizon ozone razor cozy zinc
amazing amazed graze citizen dozing hazy lazy pretzel quartz zany zest oxygen explain
explore expert complex anxious axle boxing deluxe excuse exhale exile exotic expire export
expose extend extinct flexible galaxy hoax jinx luxury mixture paradox reflex saxophone
sixty textile texture xylophone climax context example except excite exclaim exclude execute
exhaust exhibit expect expense explode exploit extract extreme fixture mixer mixing mixed
remix sixth exchange explosion expansion jigsaw joyful jumbo jockey jargon injure enjoyment
jumper joker jewelry jersey jingle judo junction jumpsuit adjust journey justice object
reject inject hijack janitor jeans jerk joystick judgment juicy jumpy majesty majority
pajamas rejoice adjective jackpot acquire antique aquarium banquet bouquet conquer
earthquake equator equation frequent inquire liquor mosque plaque quench quiver quiz request
require squeak squint squirm quality quarter liquid unique boutique critique inquiry quantum
question quickly quietly quirky quoted squeal squirt equipment mosquito quarantine
"""

# Runtime dictionary: broader, since it just needs to recognize any
# legitimate word a player might try.
DICTIONARY_MIN_LEN = 3
DICTIONARY_MAX_LEN = 15

WORD_RE = re.compile(r"^[a-z]+$")
VOWELS = set("aeiou")

# Solution words also skip anything that merely contains one of these, so no
# puzzle can hinge on an offensive word. The player dictionary uses the exact
# shared list instead, since a substring match rejects words like "spice".
BLOCKLIST = {
    "nigger", "nigga", "spic", "chink", "kike", "faggot", "retard", "whore",
    "slut", "cunt", "nigg", "coon", "gook", "tranny", "wetback", "dyke",
}


def has_consecutive_repeat(word):
    return any(word[i] == word[i + 1] for i in range(len(word) - 1))


def is_blocked(word):
    return any(bad in word for bad in BLOCKLIST)


def load_wordlist():
    with open(WORDLIST_PATH, encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]


def build_dictionary(all_words):
    """Runtime validation dictionary: any clean alphabetic word, no doubled
    letters in a row (those can never appear in a legal Edgeways word since
    a letter is fixed to one side)."""
    out = []
    for w in all_words:
        if not (DICTIONARY_MIN_LEN <= len(w) <= DICTIONARY_MAX_LEN):
            continue
        if not WORD_RE.match(w):
            continue
        if has_consecutive_repeat(w):
            continue
        if w in BLOCKED_WORDS:
            continue
        out.append(w)
    return sorted(set(out))


def build_solution_candidates(dictionary_set):
    pool = set(COMMON_WORDS.split())
    out = []
    dropped = []
    for w in sorted(pool):
        if not (SOLUTION_MIN_LEN <= len(w) <= SOLUTION_MAX_LEN):
            continue
        if not WORD_RE.match(w):
            continue
        if w not in dictionary_set:
            dropped.append(w)  # typo guard: not a real word per the word list
            continue
        if has_consecutive_repeat(w):
            continue
        if is_blocked(w) or w in BLOCKED_WORDS:
            continue
        if len(set(w)) < 4:
            continue  # too repetitive to feel like a real find
        out.append(w)
    if dropped:
        print(f"note: {len(dropped)} curated words not in the dictionary, skipped: "
              f"{', '.join(dropped)}", file=sys.stderr)
    return sorted(set(out))


def consecutive_pairs(word):
    return [(word[i], word[i + 1]) for i in range(len(word) - 1)]


def find_side_partition(letters, conflict_pairs):
    """Backtracking search for a split of `letters` (exactly 12 of them)
    into four groups of three where no conflicting pair shares a group.
    Returns a list of 4 lists of 3 letters, or None."""
    conflicts = {letter: set() for letter in letters}
    for a, b in conflict_pairs:
        if a != b:
            conflicts[a].add(b)
            conflicts[b].add(a)

    order = sorted(letters, key=lambda letter: -len(conflicts[letter]))
    groups = [[], [], [], []]

    def backtrack(idx):
        if idx == len(order):
            return True
        letter = order[idx]
        for g in groups:
            if len(g) >= 3:
                continue
            if any(other in conflicts[letter] for other in g):
                continue
            g.append(letter)
            if backtrack(idx + 1):
                return True
            g.pop()
        return False

    if backtrack(0):
        return [sorted(g) for g in groups]
    return None


def make_puzzle(words):
    """Builds a puzzle from an ordered chain of solution words (2 for
    medium/hard, 3 for easy). par is always len(words): the puzzle commits
    to exactly the solution it proves, no more."""
    combined_letters = set()
    for w in words:
        combined_letters |= set(w)
    if len(combined_letters) != 12:
        return None
    conflict_pairs = []
    for w in words:
        conflict_pairs += consecutive_pairs(w)
    groups = find_side_partition(sorted(combined_letters), conflict_pairs)
    if groups is None:
        return None
    sides = ["".join(g).upper() for g in groups]
    return {
        "sides": sides,
        "par": len(words),
        "solution": [w.upper() for w in words],
    }


def verify_puzzle(puzzle, dictionary):
    """Independent re-check of a generated puzzle against the exact rules
    core.js enforces, so a bug in the search above can't ship a broken
    daily puzzle."""
    sides = puzzle["sides"]
    assert len(sides) == 4, "must have 4 sides"
    for side in sides:
        assert len(side) == 3, "each side must have 3 letters"
    all_letters = "".join(sides)
    assert len(all_letters) == 12
    assert len(set(all_letters)) == 12, "12 distinct letters"

    side_of = {}
    for i, side in enumerate(sides):
        for ch in side:
            side_of[ch] = i

    solution = puzzle["solution"]
    assert len(solution) == puzzle["par"]

    used = set()
    prev_last = None
    for word in solution:
        assert len(word) >= 3, "word too short"
        assert word.lower() in dictionary, f"solution word not in dictionary: {word}"
        for ch in word:
            assert ch in side_of, f"letter off board: {ch}"
        for a, b in zip(word, word[1:]):
            assert side_of[a] != side_of[b], f"same-side jump in {word}"
        if prev_last is not None:
            assert word[0] == prev_last, "chain broken"
        prev_last = word[-1]
        used.update(word)

    assert used == set(all_letters), "solution does not cover all 12 letters"


def board_letters_of(puzzle):
    return set("".join(puzzle["sides"]))


def rare_ok(puzzle, rare_filter):
    """rare_filter: "any" (no constraint), "forbid" (easy: no J/Q/X/Z on
    the board), or "require" (hard: at least one of J/Q/X/Z on the board)."""
    has_rare = bool(board_letters_of(puzzle) & RARE_LETTERS)
    if rare_filter == "forbid":
        return not has_rare
    if rare_filter == "require":
        return has_rare
    return True


def generate_pair_puzzles(candidates, dictionary, count, seed, max_reuse, seen_boards, rare_filter="any", initial_use_count=None):
    """Two-word chains: word2 starts with word1's last letter. Used for
    medium (rare_filter="any") and hard (rare_filter="require")."""
    rng = random.Random(seed)
    pool = list(candidates)
    rng.shuffle(pool)

    by_first_letter = {}
    for w in pool:
        by_first_letter.setdefault(w[0], []).append(w)
    for bucket in by_first_letter.values():
        rng.shuffle(bucket)

    use_count = dict(initial_use_count) if initial_use_count else {}

    def under_cap(word):
        return use_count.get(word, 0) < max_reuse

    puzzles = []
    seen_solutions = set()

    for word1 in pool:
        if len(puzzles) >= count:
            break
        # Re-checked every iteration, not just once on entry: a single
        # word1 can otherwise complete many puzzles in the inner loop
        # below, each one raising its own use_count past the cap without
        # this loop ever noticing.
        for word2 in by_first_letter.get(word1[-1], []):
            if len(puzzles) >= count or not under_cap(word1):
                break
            if word2 == word1 or not under_cap(word2):
                continue
            pair_key = (word1, word2)
            if pair_key in seen_solutions:
                continue
            puzzle = make_puzzle([word1, word2])
            if puzzle is None:
                continue
            if not rare_ok(puzzle, rare_filter):
                continue
            board_key = tuple(sorted(puzzle["sides"]))
            if board_key in seen_boards:
                continue
            verify_puzzle(puzzle, dictionary)
            seen_boards.add(board_key)
            seen_solutions.add(pair_key)
            use_count[word1] = use_count.get(word1, 0) + 1
            use_count[word2] = use_count.get(word2, 0) + 1
            puzzles.append(puzzle)

    return puzzles


def generate_triple_puzzles(candidates, dictionary, count, seed, max_reuse, seen_boards, rare_filter="forbid", initial_use_count=None):
    """Three-word chains: word2 starts with word1's last letter, word3
    starts with word2's last letter, combined letters cover the board
    exactly. Used for easy (rare_filter="forbid": common letters only)."""
    rng = random.Random(seed)
    pool = list(candidates)
    rng.shuffle(pool)

    by_first_letter = {}
    for w in pool:
        by_first_letter.setdefault(w[0], []).append(w)
    for bucket in by_first_letter.values():
        rng.shuffle(bucket)

    use_count = dict(initial_use_count) if initial_use_count else {}

    def under_cap(word):
        return use_count.get(word, 0) < max_reuse

    puzzles = []
    seen_solutions = set()

    for word1 in pool:
        if len(puzzles) >= count:
            break
        # See the comment in generate_pair_puzzles: under_cap must be
        # re-checked on every inner iteration, not just once on entry,
        # since either loop can complete several puzzles for the same
        # word1/word2 before this outer loop gets another look.
        for word2 in by_first_letter.get(word1[-1], []):
            if len(puzzles) >= count or not under_cap(word1):
                break
            if word2 == word1 or not under_cap(word2):
                continue
            union12 = set(word1) | set(word2)
            if len(union12) > 12:
                continue
            for word3 in by_first_letter.get(word2[-1], []):
                if len(puzzles) >= count or not under_cap(word1) or not under_cap(word2):
                    break
                if word3 in (word1, word2) or not under_cap(word3):
                    continue
                if len(union12 | set(word3)) != 12:
                    continue
                solution_key = (word1, word2, word3)
                if solution_key in seen_solutions:
                    continue
                puzzle = make_puzzle([word1, word2, word3])
                if puzzle is None:
                    continue
                if not rare_ok(puzzle, rare_filter):
                    continue
                board_key = tuple(sorted(puzzle["sides"]))
                if board_key in seen_boards:
                    continue
                verify_puzzle(puzzle, dictionary)
                seen_boards.add(board_key)
                seen_solutions.add(solution_key)
                use_count[word1] = use_count.get(word1, 0) + 1
                use_count[word2] = use_count.get(word2, 0) + 1
                use_count[word3] = use_count.get(word3, 0) + 1
                puzzles.append(puzzle)

    return puzzles


def generate_bank(dictionary, seed):
    """Builds all three difficulty sections. A single seen_boards set is
    shared across them so the same twelve-letter square never ships twice
    under different difficulties. Hard is generated first since it draws
    from the smallest pool (words carrying J/Q/X/Z); medium last since it
    is the least constrained and easiest to route around collisions."""
    candidates = build_solution_candidates(dictionary)
    seen_boards = set()

    hard = generate_pair_puzzles(
        candidates, dictionary, TARGET_COUNTS["hard"], seed + 2, MAX_REUSE["hard"],
        seen_boards, rare_filter="require",
    )
    easy = generate_triple_puzzles(
        candidates, dictionary, TARGET_COUNTS["easy"], seed + 1, MAX_REUSE["easy"],
        seen_boards, rare_filter="forbid",
    )
    medium = generate_pair_puzzles(
        candidates, dictionary, TARGET_COUNTS["medium"], seed, MAX_REUSE["medium"],
        seen_boards, rare_filter="any",
    )

    return {"easy": easy, "medium": medium, "hard": hard}


def grow_bank(existing, dictionary_set, seed, targets):
    """Appends new puzzles to an already-shipped bank without touching a
    single byte of what is there. seen_boards starts pre-loaded with every
    board already shipped in ANY difficulty (the original generator shares
    one seen_boards set across all three so no square repeats), then hard,
    easy and medium each grow in turn against a seed offset well clear of
    the original generate_bank stream."""
    candidates = build_solution_candidates(dictionary_set)
    seen_boards = set()
    for diff in ("easy", "medium", "hard"):
        for p in existing[diff]["puzzles"]:
            seen_boards.add(tuple(sorted(p["sides"])))

    grown = {}
    plans = (
        ("hard", generate_pair_puzzles, "require", seed + 100002),
        ("easy", generate_triple_puzzles, "forbid", seed + 100001),
        ("medium", generate_pair_puzzles, "any", seed + 100000),
    )
    for diff, fn, rare_filter, grow_seed in plans:
        existing_puzzles = existing[diff]["puzzles"]
        needed = max(0, targets[diff] - len(existing_puzzles))
        new_puzzles = []
        if needed:
            initial_use_count = {}
            for p in existing_puzzles:
                for w in p["solution"]:
                    lw = w.lower()
                    initial_use_count[lw] = initial_use_count.get(lw, 0) + 1
            new_puzzles = fn(
                candidates, dictionary_set, needed, grow_seed, MAX_REUSE[diff],
                seen_boards, rare_filter=rare_filter, initial_use_count=initial_use_count,
            )
            new_puzzles.sort(key=lambda p: tuple(p["solution"]))
        grown[diff] = existing_puzzles + new_puzzles
    return grown


def write_dictionary(dictionary):
    DICTIONARY_PATH.write_text(
        json.dumps(dictionary, separators=(",", ":")), encoding="utf-8"
    )
    print(f"wrote {len(dictionary)} words to {DICTIONARY_PATH.relative_to(ROOT)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=20260810)
    parser.add_argument(
        "--grow-to",
        type=int,
        default=None,
        help="load the committed bank and append new puzzles up to this "
        "many per difficulty, leaving every existing puzzle untouched",
    )
    parser.add_argument(
        "--dictionary-only",
        action="store_true",
        help="rewrite games/edgeways/words.json and leave the bank alone",
    )
    args = parser.parse_args()

    all_words = load_wordlist()
    dictionary = build_dictionary(all_words)
    dictionary_set = set(dictionary)

    if args.dictionary_only:
        write_dictionary(dictionary)
        return

    if args.grow_to is not None:
        existing = json.loads(BANK_PATH.read_text(encoding="utf-8"))
        targets = {"easy": args.grow_to, "medium": args.grow_to, "hard": args.grow_to}
        sections = grow_bank(existing, dictionary_set, args.seed, targets)
    else:
        sections = generate_bank(dictionary_set, args.seed)

    bank = {}
    for diff, puzzles in sections.items():
        if len(puzzles) < MIN_BANK_SIZE:
            print(
                f"warning: {diff} only generated {len(puzzles)} puzzles, "
                f"contract wants >= {MIN_BANK_SIZE}",
                file=sys.stderr,
            )
        if args.grow_to is None:
            # Keep bank order stable and independent of dict/set iteration
            # order. Growth appends instead, to leave the committed prefix
            # byte-identical.
            puzzles.sort(key=lambda p: tuple(p["solution"]))
        bank[diff] = {"puzzles": puzzles}

    BANK_PATH.write_text(json.dumps(bank, indent=2) + "\n", encoding="utf-8")

    counts = ", ".join(f"{diff}={len(sections[diff])}" for diff in ("easy", "medium", "hard"))
    print(f"wrote {counts} puzzles to {BANK_PATH.relative_to(ROOT)}")
    write_dictionary(dictionary)


if __name__ == "__main__":
    main()
