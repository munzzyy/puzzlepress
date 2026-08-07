#!/usr/bin/env python3
"""Deterministic generator for the Clusters puzzle bank.

Builds daily puzzles from a hand-curated category pool below. Each puzzle
is four categories, one per difficulty tier (sand, amber, ink, plum from
easiest to hardest), four unique words per category, sixteen unique words
total on the board.

Categories deliberately share candidate words with each other on purpose
(a stone-fruit category and a color category both offer PLUM, several
compound-word categories both offer RAIN or WATER or KEY). That overlap is
the craft of the game: when a puzzle happens to draw two categories that
both want the same word, this script resolves it by giving the word to
whichever category was assigned first and falling back to another of that
category's candidates for the loser, so the finished puzzle still reads as
a deliberate near-miss trap for the player rather than a generation bug.

Usage: python3 tools/gen_clusters.py [--seed N] [--count N] [--out PATH]
"""
import argparse
import json
import random
import sys
from pathlib import Path

TIERS = ("sand", "amber", "ink", "plum")
RESERVED_WORDS = {"SAND", "AMBER", "INK", "PLUM"}

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "data" / "clusters.json"

# ---------------------------------------------------------------------------
# Category pool. Each entry: (tier, id, display name, word list).
# Word lists run 4-7 candidates; the generator picks 4 per puzzle. Tiers run
# easiest (sand, broad everyday groupings) to hardest (plum, compound-word
# wordplay where the category name is "words before/after X").
# ---------------------------------------------------------------------------

CATEGORIES = [
    # ---------------- sand: broad, obvious groupings ----------------
    ("sand", "shades_of_blue", "Shades of blue",
     ["NAVY", "COBALT", "AZURE", "TEAL", "CERULEAN", "SKY"]),
    ("sand", "chess_pieces", "Chess pieces",
     ["KING", "QUEEN", "ROOK", "BISHOP", "KNIGHT", "PAWN"]),
    ("sand", "card_suits", "Card suits",
     ["HEARTS", "CLUBS", "SPADES", "DIAMONDS"]),
    ("sand", "table_settings", "Things on a place setting",
     ["FORK", "SPOON", "KNIFE", "PLATE", "BOWL", "NAPKIN"]),
    ("sand", "primary_secondary_colors", "Primary and secondary colors",
     ["RED", "BLUE", "YELLOW", "GREEN", "ORANGE", "PURPLE"]),
    ("sand", "weather_words", "Types of weather",
     ["RAIN", "SNOW", "WIND", "FOG", "HAIL", "SLEET"]),
    ("sand", "farm_animals", "Farm animals",
     ["COW", "PIG", "HORSE", "SHEEP", "GOAT", "CHICKEN"]),
    ("sand", "units_of_time", "Units of time",
     ["SECOND", "MINUTE", "HOUR", "DAY", "WEEK", "MONTH"]),
    ("sand", "kitchen_appliances", "Kitchen appliances",
     ["OVEN", "TOASTER", "BLENDER", "KETTLE", "MICROWAVE", "FRIDGE"]),
    ("sand", "body_parts", "Body parts",
     ["ARM", "LEG", "HAND", "FOOT", "KNEE", "ELBOW"]),
    ("sand", "tree_types", "Trees",
     ["OAK", "MAPLE", "PINE", "BIRCH", "ELM", "CEDAR"]),
    ("sand", "tabletop_games", "Tabletop games",
     ["CHESS", "CHECKERS", "DOMINOES", "BACKGAMMON", "MANCALA", "CARDS"]),
    ("sand", "ocean_creatures", "Ocean creatures",
     ["SHARK", "WHALE", "DOLPHIN", "OCTOPUS", "CRAB", "EEL"]),
    ("sand", "breakfast_foods", "Breakfast foods",
     ["TOAST", "BACON", "PANCAKE", "WAFFLE", "OMELET", "CEREAL"]),
    ("sand", "musical_instruments", "Musical instruments",
     ["PIANO", "GUITAR", "DRUMS", "VIOLIN", "FLUTE", "TRUMPET"]),
    ("sand", "cloud_types", "Cloud types",
     ["CUMULUS", "CIRRUS", "STRATUS", "NIMBUS"]),
    ("sand", "days_of_week", "Days of the week",
     ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]),
    ("sand", "seasons", "Seasons",
     ["SPRING", "SUMMER", "AUTUMN", "WINTER"]),
    ("sand", "flowers", "Flowers",
     ["ROSE", "LILY", "TULIP", "DAISY", "IRIS", "ORCHID"]),
    ("sand", "citrus_fruits", "Citrus fruits",
     ["LEMON", "LIME", "ORANGE", "GRAPEFRUIT", "TANGERINE", "CLEMENTINE"]),
    ("sand", "pasta_shapes", "Pasta shapes",
     ["PENNE", "FUSILLI", "LINGUINE", "RAVIOLI", "RIGATONI", "MACARONI"]),
    ("sand", "desert_animals", "Desert animals",
     ["CAMEL", "SCORPION", "LIZARD", "COYOTE", "VULTURE", "TORTOISE"]),
    ("sand", "household_tools", "Household tools",
     ["HAMMER", "WRENCH", "PLIERS", "SCREWDRIVER", "DRILL", "CHISEL"]),
    ("sand", "baking_ingredients", "Baking ingredients",
     ["FLOUR", "SUGAR", "BUTTER", "YEAST", "SALT", "EGGS"]),

    # ---------------- amber: still concrete, one extra step ----------------
    ("amber", "words_for_happy", "Words for happy",
     ["GLAD", "JOYFUL", "CHEERFUL", "CONTENT", "ELATED", "MERRY"]),
    ("amber", "words_for_angry", "Words for angry",
     ["FURIOUS", "IRATE", "LIVID", "CROSS", "IRKED", "ENRAGED"]),
    ("amber", "words_for_smart", "Words for smart",
     ["CLEVER", "BRIGHT", "SHARP", "ASTUTE", "SHREWD", "WITTY"]),
    ("amber", "types_of_laughter", "Types of laughter",
     ["GIGGLE", "CHUCKLE", "SNICKER", "CACKLE", "GUFFAW", "SNORT"]),
    ("amber", "ways_to_walk", "Ways to walk",
     ["STROLL", "STRIDE", "STOMP", "SAUNTER", "TROT", "SHUFFLE"]),
    ("amber", "ways_to_look", "Ways to look at something",
     ["GLANCE", "STARE", "GAZE", "PEEK", "GLIMPSE", "PEER"]),
    ("amber", "types_of_boats", "Types of boats",
     ["CANOE", "KAYAK", "SCHOONER", "DINGHY", "CATAMARAN", "TUGBOAT"]),
    ("amber", "dance_styles", "Dance styles",
     ["TANGO", "WALTZ", "SALSA", "FOXTROT", "JIVE", "RUMBA"]),
    ("amber", "sewing_terms", "Sewing terms",
     ["NEEDLE", "THREAD", "SEAM", "HEM", "BUTTON", "ZIPPER"]),
    ("amber", "hat_types", "Kinds of hats",
     ["BERET", "FEDORA", "BEANIE", "VISOR", "SOMBRERO", "BOWLER"]),
    ("amber", "desert_landforms", "Desert landforms",
     ["DUNE", "OASIS", "MESA", "CANYON", "BUTTE", "PLATEAU"]),
    ("amber", "bread_types", "Kinds of bread",
     ["BAGUETTE", "SOURDOUGH", "RYE", "CIABATTA", "BRIOCHE", "PITA"]),
    ("amber", "shoe_types", "Kinds of shoes",
     ["LOAFER", "SNEAKER", "SANDAL", "BOOT", "MOCCASIN", "CLOG"]),
    ("amber", "knot_types", "Kinds of knots",
     ["SQUARE", "BOWLINE", "SLIPKNOT", "GRANNY", "CLOVE", "TRUCKER"]),
    ("amber", "gemstones", "Gemstones",
     ["PEARL", "JADE", "OPAL", "RUBY", "TOPAZ", "GARNET"]),
    ("amber", "herbs_and_spices", "Herbs and spices",
     ["BASIL", "THYME", "OREGANO", "CUMIN", "SAGE", "PAPRIKA"]),
    ("amber", "constellations", "Constellations",
     ["ORION", "LYRA", "PEGASUS", "PERSEUS", "DRACO", "HYDRA"]),
    ("amber", "dog_breeds", "Dog breeds",
     ["BEAGLE", "POODLE", "COLLIE", "TERRIER", "HUSKY", "BOXER"]),
    ("amber", "card_games", "Card games",
     ["BRIDGE", "POKER", "RUMMY", "HEARTS", "EUCHRE", "CANASTA"]),
    ("amber", "combat_sports", "Combat sports",
     ["KARATE", "JUDO", "AIKIDO", "KENDO", "SUMO", "BOXING"]),
    ("amber", "weather_phenomena", "Severe weather",
     ["THUNDER", "LIGHTNING", "TORNADO", "BLIZZARD", "DROUGHT", "MONSOON"]),
    ("amber", "cooking_methods", "Cooking methods",
     ["BAKE", "ROAST", "SIMMER", "SAUTE", "BRAISE", "GRILL"]),
    ("amber", "map_features", "Things on a map",
     ["LEGEND", "COMPASS", "SCALE", "BORDER", "ROUTE", "KEY"]),
    ("amber", "shades_of_purple", "Shades of purple",
     ["LILAC", "VIOLET", "MAUVE", "ORCHID", "INDIGO", "AMETHYST"]),

    # ---------------- ink: needs a specific insight ----------------
    ("ink", "stone_fruits", "Stone fruits",
     ["PEACH", "DAMSON", "APRICOT", "NECTARINE", "CHERRY", "MANGO"]),
    ("ink", "flower_derived_colors", "Colors named after flowers",
     ["ROSE", "LILAC", "VIOLET", "IRIS", "MARIGOLD", "LAVENDER"]),
    ("ink", "things_with_a_face", "Things that have a face",
     ["CLOCK", "CARD", "COIN", "CLIFF", "WATCH", "DIE"]),
    ("ink", "things_that_crack", "Things that can be cracked",
     ["EGG", "CODE", "JOKE", "KNUCKLE", "SAFE", "WHIP"]),
    ("ink", "things_with_a_spine", "Things that have a spine",
     ["BOOK", "CACTUS", "HEDGEHOG", "PORCUPINE", "RIDGE", "PERSON"]),
    ("ink", "carat_measured", "Things measured in carats",
     ["DIAMOND", "RUBY", "EMERALD", "SAPPHIRE", "TOPAZ", "GARNET"]),
    ("ink", "things_with_rings", "Things that have rings",
     ["TREE", "SATURN", "ONION", "BOXING", "CIRCUS", "TELEPHONE"]),
    ("ink", "things_that_break", "Things that can be broken",
     ["RECORD", "PROMISE", "HEART", "ICE", "NEWS", "HABIT"]),
    ("ink", "animal_group_names", "Animal group names",
     ["MURDER", "PRIDE", "POD", "FLOCK", "HERD", "SWARM"]),
    ("ink", "things_with_keys", "Things that have keys",
     ["PIANO", "MAP", "KEYBOARD", "LOCK", "CIPHER", "CAR"]),
    ("ink", "things_that_go_stale", "Things that can go stale",
     ["BREAD", "NEWS", "JOKE", "AIR", "IDEA", "CHIPS"]),
    ("ink", "things_with_a_trunk", "Things that have a trunk",
     ["TREE", "ELEPHANT", "CAR", "SWIMSUIT", "TORSO"]),
    ("ink", "things_with_a_bed", "Things that have a bed",
     ["RIVER", "FLOWER", "TRUCK", "OCEAN", "HOSPITAL"]),
    ("ink", "things_with_a_crown", "Things that have a crown",
     ["TOOTH", "KING", "HEAD", "TREE", "HAT"]),
    ("ink", "stringed_instruments", "Stringed instruments",
     ["GUITAR", "VIOLIN", "HARP", "CELLO", "BANJO", "UKULELE"]),
    ("ink", "things_with_a_shell", "Things that have a shell",
     ["TURTLE", "EGG", "NUT", "CRAB", "SNAIL", "LOBSTER"]),
    ("ink", "knot_speed", "Things measured in knots",
     ["SHIP", "BOAT", "WIND", "AIRCRAFT", "YACHT", "SUBMARINE"]),
    ("ink", "things_with_a_neck", "Things that have a neck",
     ["BOTTLE", "GUITAR", "SHIRT", "GIRAFFE", "VIOLIN"]),
    ("ink", "things_with_a_bark", "Things that have a bark",
     ["DOG", "TREE", "SEAL", "FOX", "COYOTE"]),
    ("ink", "things_with_a_head", "Things that have a head",
     ["PIN", "BED", "NAIL", "LETTUCE", "DEPARTMENT"]),

    # ---------------- plum: compound-word wordplay ----------------
    ("plum", "before_fall", "Words that precede FALL",
     ["WATER", "RAIN", "PIT", "NIGHT", "FREE", "SHORT"]),
    ("plum", "before_light", "Words that precede LIGHT",
     ["MOON", "SUN", "DAY", "LAMP", "HIGH", "SPOT"]),
    ("plum", "before_house", "Words that precede HOUSE",
     ["GREEN", "LIGHT", "WARE", "TREE", "DOG", "PENT"]),
    ("plum", "before_berry", "Words that precede BERRY",
     ["STRAW", "BLUE", "RASP", "BLACK", "GOOSE", "CRAN"]),
    ("plum", "before_bow", "Words that precede BOW",
     ["RAIN", "CROSS", "LONG", "OX"]),
    ("plum", "before_stone", "Words that precede STONE",
     ["LIME", "MILE", "CORNER", "KEY", "GALL", "BIRTH"]),
    ("plum", "before_case", "Words that precede CASE",
     ["BRIEF", "SUIT", "BOOK", "STAIR", "SHOW", "UPPER"]),
    ("plum", "before_board", "Words that precede BOARD",
     ["KEY", "SURF", "CARD", "DASH", "CHALK", "SNOW"]),
    ("plum", "before_mark", "Words that precede MARK",
     ["BOOK", "BENCH", "TRADE", "LAND", "HALL", "POST"]),
    ("plum", "before_line", "Words that precede LINE",
     ["HEAD", "DEAD", "BASE", "PUNCH", "HAIR", "SIDE"]),
    ("plum", "before_ball", "Words that precede BALL",
     ["BASE", "FOOT", "BASKET", "EYE", "SNOW", "HAND"]),
    ("plum", "before_bird", "Words that precede BIRD",
     ["BLACK", "LOVE", "MOCKING", "LADY", "JAY", "THUNDER"]),
    ("plum", "before_storm", "Words that precede STORM",
     ["BRAIN", "THUNDER", "DUST", "SNOW", "FIRE", "RAIN"]),
    ("plum", "before_time", "Words that precede TIME",
     ["BED", "DAY", "LIFE", "OVER", "SOME", "ANY"]),
    ("plum", "before_work", "Words that precede WORK",
     ["HOME", "NET", "FRAME", "PATCH", "TEAM"]),
    ("plum", "before_room", "Words that precede ROOM",
     ["BATH", "BED", "CLASS", "MUSH", "REST", "SHOW"]),
    ("plum", "before_coat", "Words that precede COAT",
     ["RAIN", "OVER", "PETTI", "TOP"]),
    ("plum", "before_pack", "Words that precede PACK",
     ["BACK", "SIX", "ICE", "WOLF", "RAT", "FANNY"]),
    ("plum", "before_out", "Words that precede OUT",
     ["BLACK", "WORK", "HAND", "LAY", "BURN", "CHECK"]),
    ("plum", "before_side", "Words that precede SIDE",
     ["OUT", "IN", "UP", "DOWN", "BED", "COUNTRY"]),
    ("plum", "after_sun", "Words that follow SUN",
     ["RISE", "SET", "FLOWER", "SHINE", "BURN", "GLASSES"]),
    ("plum", "after_over", "Words that follow OVER",
     ["LOOK", "DUE", "SEE", "ALL", "BOARD", "THROW"]),
    ("plum", "after_water", "Words that follow WATER",
     ["MELON", "PROOF", "MARK", "SHED", "WAY", "LOGGED"]),
]

def normalized_categories():
    cats = []
    seen_ids = set()
    for tier, cat_id, name, words in CATEGORIES:
        assert tier in TIERS, f"unknown tier {tier!r} for category {cat_id}"
        assert cat_id not in seen_ids, f"duplicate category id {cat_id}"
        seen_ids.add(cat_id)
        assert len(words) == len(set(words)), f"dup word within {cat_id}"
        assert len(words) >= 4, f"category {cat_id} needs at least 4 words"
        for w in words:
            assert w.isalpha() and w.isupper(), f"bad word {w!r} in {cat_id}"
            assert w not in RESERVED_WORDS, f"category {cat_id} uses reserved tier word {w!r}"
        cats.append({"tier": tier, "id": cat_id, "name": name, "words": list(words)})
    return cats


def categories_by_tier(cats):
    by_tier = {t: [] for t in TIERS}
    for c in cats:
        by_tier[c["tier"]].append(c)
    return by_tier


def pick_disjoint_subset(candidates, used_words, k, rng):
    pool = candidates[:]
    rng.shuffle(pool)
    available = [w for w in pool if w not in used_words]
    if len(available) < k:
        return None
    return available[:k]


def build_puzzle(rng, by_tier, used_combos, used_word_sets, max_attempts=200):
    for _ in range(max_attempts):
        chosen = {tier: rng.choice(by_tier[tier]) for tier in TIERS}
        combo_key = tuple(chosen[t]["id"] for t in TIERS)
        if combo_key in used_combos:
            continue

        picked = {}
        used_words = set()
        ok = True
        for tier in TIERS:
            cat = chosen[tier]
            subset = pick_disjoint_subset(cat["words"], used_words, 4, rng)
            if subset is None:
                ok = False
                break
            picked[tier] = subset
            used_words.update(subset)
        if not ok:
            continue

        word_set_key = frozenset(used_words)
        if word_set_key in used_word_sets:
            continue

        used_combos.add(combo_key)
        used_word_sets.add(word_set_key)
        groups = [
            {"name": chosen[t]["name"], "words": picked[t], "tier": t}
            for t in TIERS
        ]
        return {"groups": groups}
    return None


def generate(seed, count):
    rng = random.Random(seed)
    cats = normalized_categories()
    by_tier = categories_by_tier(cats)
    for tier in TIERS:
        assert len(by_tier[tier]) >= 4, f"need more {tier} categories"

    used_combos = set()
    used_word_sets = set()
    puzzles = []
    misses = 0
    while len(puzzles) < count and misses < 2000:
        puzzle = build_puzzle(rng, by_tier, used_combos, used_word_sets)
        if puzzle is None:
            misses += 1
            continue
        puzzles.append(puzzle)
    return puzzles


def validate_bank(puzzles):
    assert isinstance(puzzles, list) and len(puzzles) > 0, "empty bank"
    seen_word_sets = set()
    for i, p in enumerate(puzzles):
        groups = p["groups"]
        assert len(groups) == 4, f"puzzle {i}: needs 4 groups"
        tiers_seen = [g["tier"] for g in groups]
        assert sorted(tiers_seen) == sorted(TIERS), f"puzzle {i}: tier set wrong"
        assert len(set(tiers_seen)) == 4, f"puzzle {i}: duplicate tier"

        all_words = []
        for g in groups:
            assert isinstance(g["name"], str) and g["name"].strip(), f"puzzle {i}: blank name"
            words = g["words"]
            assert len(words) == 4, f"puzzle {i}: group {g['name']} needs 4 words"
            assert len(set(words)) == 4, f"puzzle {i}: duplicate word in group {g['name']}"
            for w in words:
                assert w.isalpha() and w.isupper(), f"puzzle {i}: bad word {w!r}"
                assert w not in RESERVED_WORDS, f"puzzle {i}: reserved word {w!r} used as a tile"
            all_words.extend(words)

        assert len(all_words) == 16, f"puzzle {i}: expected 16 tiles"
        assert len(set(all_words)) == 16, f"puzzle {i}: duplicate word across groups"

        word_set_key = frozenset(all_words)
        assert word_set_key not in seen_word_sets, f"puzzle {i}: duplicate of an earlier puzzle"
        seen_word_sets.add(word_set_key)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=810, help="RNG seed (default 810)")
    parser.add_argument("--count", type=int, default=150, help="target puzzle count")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output JSON path")
    args = parser.parse_args()

    puzzles = generate(args.seed, args.count)
    validate_bank(puzzles)

    bank = {"puzzles": puzzles}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(bank, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    if len(puzzles) < args.count:
        print(
            f"warning: only generated {len(puzzles)} of {args.count} requested puzzles "
            "(category pool exhausted before hitting the target)",
            file=sys.stderr,
        )
    print(f"wrote {len(puzzles)} puzzles to {args.out}")


if __name__ == "__main__":
    main()
