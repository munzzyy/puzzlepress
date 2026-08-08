#!/usr/bin/env python3
"""Deterministic generator for data/wordweave.json.

Wordweave is a letter grid where every cell belongs to exactly one theme
word or the spangram: there is no filler. The spangram is a word that
touches two opposite edges of the grid and names the theme.

v2 ships three difficulties, each its own bank section:
  easy   - 6x6 grid (36 cells), theme title shown from the start in-game.
  medium - 6x8 grid (48 cells), the v1 behavior: title hidden until the
           spanning word is found.
  hard   - 6x8 grid (48 cells), title hidden the same way as medium, but
           puzzles are drawn from a disjoint theme pool and required to
           carry more target words (>= 6 total, spangram included) so the
           grid is measurably busier to fully clear.

Approach: build a randomized Hamiltonian path over the grid's king-move
adjacency graph (every cell touches up to 8 neighbors), scan it for a
window of the spangram's length that runs edge to edge, then split the two
remaining runs of the path into pieces that match a chosen set of theme
words. Because consecutive path cells are always king-adjacent by
construction, every resulting word is automatically a legal chain and the
whole grid is automatically fully tiled with zero overlap.

Run: python3 tools/gen_wordweave.py --seed 20260810 --out data/wordweave.json
"""

import argparse
import itertools
import json
import random
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WORDLIST_PATH = REPO_ROOT / "data" / "wordlist.txt"
OUT_PATH = REPO_ROOT / "data" / "wordweave.json"

MIN_WORD_LEN = 4
MAX_BONUS_LEN = 9
MAX_BONUS_PER_PUZZLE = 40
MIN_THEME_WORDS = 4
MAX_THEME_WORDS = 9
HARD_MIN_THEME_WORDS = 6

EASY_ROWS, EASY_COLS = 6, 6
STD_ROWS, STD_COLS = 8, 6
MIN_BANK_SIZE = 50

BLOCKLIST = {
    "arse", "arsehole", "ass", "asses", "bastard", "bitch", "bitches",
    "bloody", "bugger", "bullshit", "coon", "coons", "crap", "crappy",
    "cunt", "cunts", "damn", "damned", "dammit", "dick", "dicks", "dyke",
    "dykes", "fag", "fags", "faggot", "gook", "gooks", "hell", "hooker",
    "jerkoff", "kike", "kikes", "kraut", "krauts", "negro", "negroes",
    "nigger", "niggers", "piss", "pissed", "prick", "pricks", "pussy",
    "pussies", "shit", "shits", "shitty", "slut", "sluts", "spic", "spics",
    "tits", "twat", "twats", "wank", "wanker", "wetback", "wetbacks",
    "whore", "whores", "wog", "wogs",
}

# ---------------------------------------------------------------------
# Curated theme pools. Each entry is (theme name, spangram, other words).
# spangram length must be 6-11 (needs to span 6 columns or 6-8 rows). Every
# word (spangram included) must be >= MIN_WORD_LEN and a real dictionary
# entry; that is enforced by validate_themes() below before generation.
# ---------------------------------------------------------------------
THEMES = [
    ("Coffee shop", "ESPRESSO", ["LATTE", "MOCHA", "BEANS", "GRIND", "FILTER", "STEAM", "FOAM", "POUR", "ROAST", "BREW", "AROMA", "BLEND"]),
    ("Bakery case", "PASTRIES", ["BREAD", "DOUGH", "YEAST", "FLOUR", "BUTTER", "SUGAR", "CRUST", "KNEAD", "LOAF", "ROLL", "BAGEL", "MUFFIN"]),
    ("Pizza night", "TOPPINGS", ["CRUST", "SAUCE", "CHEESE", "DOUGH", "SLICE", "OVEN", "BASIL", "PEPPER", "ONION", "CRISP", "BAKE", "KNEAD"]),
    ("Breakfast table", "PANCAKES", ["SYRUP", "BUTTER", "TOAST", "BACON", "EGGS", "JUICE", "WAFFLE", "CEREAL", "JAM", "HONEY", "MILK", "GRIDDLE"]),
    ("Farmers market", "PRODUCE", ["STALL", "CROP", "BASKET", "HARVEST", "VENDOR", "FRESH", "ORGANIC", "PRICE", "SCALE", "TABLE", "TENT", "BUNCH"]),
    ("Ice cream shop", "SUNDAE", ["SCOOP", "CONE", "SPRINKLE", "FUDGE", "SYRUP", "CHERRY", "WAFFLE", "VANILLA", "SWIRL", "CUP", "TOPPING", "CREAM"]),
    ("Tea time", "STEEPING", ["KETTLE", "LEAVES", "CUP", "SAUCER", "HERBAL", "GREEN", "HONEY", "SPOON", "WARM", "SIP", "POT", "BLEND", "INFUSION", "AROMA", "PORCELAIN"]),
    ("Backyard barbecue", "GRILLING", ["SMOKE", "COALS", "SAUCE", "SKEWER", "MARINADE", "FLAME", "PATTY", "RIBS", "TONGS", "CHAR", "SIZZLE", "RUB"]),
    ("Salad bar", "GREENS", ["LETTUCE", "TOMATO", "CROUTON", "DRESSING", "ONION", "PEPPER", "CARROT", "SPINACH", "OLIVE", "BOWL", "TOSS", "FRESH"]),
    ("Soup kitchen", "LADLED", ["BROTH", "NOODLE", "CARROT", "ONION", "SIMMER", "STEAM", "BOWL", "SPOON", "WARM", "STOCK", "HERB", "SALT"]),
    ("Camping trip", "CAMPFIRE", ["TENT", "ROPE", "TRAIL", "PACK", "STOVE", "LANTERN", "SLEEP", "HIKE", "WOODS", "SCOUT", "MAP", "SPARK"]),
    ("Mountain climb", "SUMMIT", ["ROPE", "PEAK", "CLIFF", "LEDGE", "CLIMB", "GEAR", "RIDGE", "SNOW", "ROCK", "GUIDE", "TRAIL", "BOOT", "ASCENT", "ELEVATION", "RAPPEL"]),
    ("Beach day", "SEASHELL", ["SAND", "WAVE", "TOWEL", "UMBRELLA", "SHORE", "SURF", "TIDE", "SHELL", "KITE", "SUN", "SWIM", "COOLER"]),
    ("Rainforest canopy", "CANOPY", ["VINE", "MOSS", "FERN", "MIST", "PARROT", "MONKEY", "TRUNK", "LEAF", "DAMP", "SHADE", "ROOT", "HUMID", "THICKET", "HUMIDITY", "RAINFALL"]),
    ("Desert trek", "MIRAGE", ["SAND", "DUNE", "CACTUS", "CAMEL", "HEAT", "OASIS", "THIRST", "ROCK", "SCORCH", "TRAIL", "WIND", "DUST", "BLISTER", "BARREN", "BOULDER"]),
    ("Winter storm", "BLIZZARD", ["SNOW", "WIND", "FROST", "SLEET", "DRIFT", "CHILL", "ICE", "SHOVEL", "COAT", "BOOTS", "FLAKE", "GUST"]),
    ("Thunderstorm", "LIGHTNING", ["RAIN", "CLOUD", "THUNDER", "BOLT", "FLASH", "WIND", "DRIZZLE", "GUST", "DAMP", "STORM", "ROAR", "DARK"]),
    ("Garden bed", "BLOSSOM", ["SEED", "SOIL", "ROOT", "STEM", "PETAL", "BLOOM", "WEED", "VINE", "SPROUT", "SHOVEL", "HOSE", "PRUNE", "SEEDLING", "DAFFODIL", "TULIP"]),
    ("Autumn walk", "HARVEST", ["LEAVES", "ACORN", "CRISP", "MAPLE", "RAKE", "PUMPKIN", "CIDER", "CHILL", "AMBER", "WIND", "WALK", "BRANCH"]),
    ("Spring thaw", "BLOOMING", ["BUD", "RAIN", "GREEN", "SPROUT", "WARM", "MELT", "PETAL", "NEST", "GROW", "FRESH", "DRIP", "GARDEN", "TULIP", "PETUNIA", "RAINFALL"]),
    ("Farm animals", "LIVESTOCK", ["HORSE", "GOAT", "SHEEP", "PIG", "COW", "HEN", "BARN", "STABLE", "FEED", "HAY", "FIELD", "PASTURE", "PADDOCK", "TROUGH", "CORRAL"]),
    ("Bird watching", "SONGBIRD", ["NEST", "FEATHER", "WING", "PERCH", "FLOCK", "BEAK", "CHIRP", "ROBIN", "SPARROW", "EGG", "BRANCH", "SOAR"]),
    ("Big cats", "LEOPARD", ["LION", "TIGER", "PANTHER", "CLAW", "ROAR", "STRIPE", "JUNGLE", "PREY", "PRIDE", "HUNT", "PAW", "FANG"]),
    ("Ocean depths", "OCTOPUS", ["CORAL", "REEF", "WAVE", "TIDE", "KELP", "CRAB", "CLAM", "SQUID", "SHARK", "WHALE", "DOLPHIN", "LAGOON"]),
    ("Insect world", "BUTTERFLY", ["ANT", "BEETLE", "WASP", "MOTH", "HIVE", "SWARM", "WING", "ANTENNA", "COCOON", "BUZZ", "CRAWL", "POLLEN"]),
    ("Dog breeds", "RETRIEVER", ["LEASH", "COLLAR", "BARK", "FETCH", "PUPPY", "KENNEL", "TAIL", "PAW", "BONE", "LOYAL", "WALK", "TRAIN"]),
    ("Cat behavior", "WHISKERS", ["PURR", "CLAW", "TAIL", "POUNCE", "NAP", "PERCH", "HISS", "GROOM", "PAW", "STRETCH", "CURL", "PROWL"]),
    ("Reptile house", "CROCODILE", ["SNAKE", "LIZARD", "SCALE", "TURTLE", "VENOM", "FANG", "SHELL", "SWAMP", "POND", "HATCH", "SLITHER", "BASK"]),
    ("Zoo visit", "ENCLOSURE", ["CAGE", "KEEPER", "FENCE", "HABITAT", "VISIT", "TICKET", "GUIDE", "SIGN", "FEED", "WATCH", "TRAIL", "GATE"]),
    ("Arctic wildlife", "PENGUIN", ["ICE", "SEAL", "WALRUS", "POLAR", "SNOW", "FLOE", "TUSK", "FIN", "COLD", "DRIFT", "HUNT", "WHITE", "ICEBERG", "GLACIER", "TUNDRA"]),
    ("Laundry day", "DETERGENT", ["WASH", "RINSE", "DRYER", "FOLD", "IRON", "HAMPER", "STAIN", "SOAP", "FABRIC", "SPIN", "HANG", "LINT"]),
    ("Spring cleaning", "SCRUBBING", ["MOP", "BROOM", "DUST", "POLISH", "SPONGE", "RAG", "BUCKET", "SOAP", "WIPE", "SWEEP", "SHINE", "TIDY"]),
    ("Bedroom", "MATTRESS", ["PILLOW", "BLANKET", "SHEET", "LAMP", "DRESSER", "CLOSET", "RUG", "CURTAIN", "ALARM", "NIGHT", "QUILT", "FRAME"]),
    ("Living room", "FIREPLACE", ["SOFA", "CARPET", "LAMP", "SHELF", "CUSHION", "MANTLE", "RUG", "TABLE", "CURTAIN", "WINDOW", "CHAIR", "COZY"]),
    ("Bathroom", "SHOWERHEAD", ["TOWEL", "SOAP", "MIRROR", "DRAIN", "FAUCET", "TILE", "SINK", "BRUSH", "RAZOR", "STEAM", "TUB", "RINSE"]),
    ("Toolshed", "HAMMER", ["WRENCH", "NAIL", "SCREW", "DRILL", "SAW", "LADDER", "BOLT", "PLIERS", "TAPE", "PAINT", "GLUE", "BENCH"]),
    ("Sewing kit", "NEEDLE", ["THREAD", "BUTTON", "FABRIC", "PATCH", "SEAM", "STITCH", "PIN", "SCISSORS", "HEM", "CLOTH", "SPOOL", "ZIPPER"]),
    ("Attic clutter", "STORAGE", ["BOX", "DUST", "TRUNK", "COBWEB", "LADDER", "RAFTER", "JUNK", "RELIC", "LAMP", "CRATE", "PACK", "SHELF"]),
    ("Moving day", "CARDBOARD", ["BOX", "TAPE", "TRUCK", "LABEL", "LIFT", "PACK", "WRAP", "DOLLY", "CRATE", "LOAD", "HAUL", "MOVE", "PACKING", "CARTON", "UNPACK"]),
    ("Home repair", "TOOLBOX", ["HAMMER", "SCREW", "NAIL", "PAINT", "DRILL", "FIX", "PATCH", "LEAK", "WRENCH", "LADDER", "TAPE", "BOLT"]),
    ("Road trip", "HIGHWAY", ["MAP", "GAS", "EXIT", "SNACK", "RADIO", "MOTEL", "DETOUR", "MILES", "TRUNK", "DRIVE", "REST", "CRUISE"]),
    ("Airport", "BOARDING", ["GATE", "TICKET", "LUGGAGE", "PILOT", "RUNWAY", "CABIN", "DELAY", "TERMINAL", "PASSPORT", "FLIGHT", "SEAT", "CREW"]),
    ("Train ride", "CONDUCTOR", ["TRACK", "CABIN", "WHISTLE", "DEPOT", "TICKET", "PLATFORM", "ENGINE", "CARGO", "RAIL", "SEAT", "DEPART", "CHUG"]),
    ("Sailing trip", "HARBOR", ["SAIL", "DECK", "ANCHOR", "MAST", "WAVE", "CREW", "ROPE", "WIND", "PORT", "BOAT", "TIDE", "KNOT", "RIGGING", "STARBOARD", "COMPASS"]),
    ("Road signs", "CROSSING", ["STOP", "YIELD", "DETOUR", "SPEED", "ARROW", "MERGE", "LANE", "ROUTE", "EXIT", "CURVE", "SIGNAL", "TRAFFIC"]),
    ("City streets", "SKYLINE", ["AVENUE", "TAXI", "CROWD", "BLOCK", "CORNER", "ALLEY", "TRAFFIC", "CURB", "BUS", "SIDEWALK", "LIGHT", "DISTRICT"]),
    ("Countryside", "MEADOW", ["FIELD", "FARM", "BARN", "FENCE", "CREEK", "HILL", "PASTURE", "TRAIL", "ORCHARD", "POND", "GRAZE", "QUIET"]),
    ("Island getaway", "LAGOON", ["PALM", "SAND", "REEF", "BREEZE", "SHORE", "TIDE", "HAMMOCK", "COVE", "SUNSET", "WAVE", "RAFT", "DRIFT", "SHORELINE", "TROPICAL", "SUNBURN"]),
    ("Mountain town", "CHIMNEY", ["LODGE", "SNOW", "PEAK", "TRAIL", "FIRE", "PINE", "CABIN", "FROST", "SLOPE", "VALLEY", "RIDGE", "QUAINT"]),
    ("Desert town", "CANYON", ["DUST", "MESA", "CACTUS", "SUNSET", "PORCH", "HEAT", "PLAZA", "TILE", "ADOBE", "ROAD", "QUIET", "MIRAGE"]),
    ("Painter's studio", "CANVAS", ["BRUSH", "EASEL", "PALETTE", "SKETCH", "PAINT", "FRAME", "SHADE", "BLEND", "LAYER", "STROKE", "TINT", "STUDIO"]),
    ("Pottery class", "CERAMIC", ["CLAY", "WHEEL", "GLAZE", "KILN", "MOLD", "SHAPE", "FIRE", "BOWL", "VASE", "CARVE", "SMOOTH", "SPIN", "GLAZING", "PORCELAIN", "TEXTURE"]),
    ("Knitting circle", "SWEATER", ["YARN", "NEEDLE", "STITCH", "LOOP", "WOOL", "PATTERN", "SCARF", "KNOT", "THREAD", "ROW", "CAST", "PURL"]),
    ("Photography", "APERTURE", ["LENS", "SHUTTER", "FOCUS", "FRAME", "LIGHT", "ANGLE", "FILTER", "ZOOM", "FLASH", "PRINT", "EXPOSE", "CAPTURE"]),
    ("Bookbinding", "LIBRARY", ["PAGE", "SPINE", "COVER", "BINDING", "PRINT", "PAPER", "INK", "GLUE", "SHELF", "VOLUME", "FOLD", "CHAPTER"]),
    ("Woodworking", "CARPENTER", ["CHISEL", "LATHE", "SAW", "PLANE", "JOINT", "SAND", "VARNISH", "GRAIN", "CLAMP", "BENCH", "CARVE", "POLISH"]),
    ("Chess club", "CHECKMATE", ["PAWN", "KNIGHT", "BISHOP", "ROOK", "QUEEN", "BOARD", "MOVE", "CAPTURE", "TIMER", "MATCH", "OPEN", "TACTIC"]),
    ("Board games", "TABLETOP", ["TOKEN", "BOARD", "TURN", "SPACE", "CARD", "ROLL", "RULES", "PLAYER", "SQUARE", "SPIN", "WINNER", "PIECE"]),
    ("Card games", "SHUFFLE", ["DECK", "SUIT", "DEAL", "TRUMP", "HAND", "BLUFF", "ACE", "JOKER", "TABLE", "BET", "DRAW", "MATCH", "DEALER", "REMATCH", "DISCARD"]),
    ("Jigsaw puzzles", "PIECES", ["EDGE", "CORNER", "FRAME", "SORT", "IMAGE", "BORDER", "MATCH", "FIT", "TABLE", "PATIENCE", "SHAPE", "GAP"]),
    ("Soccer match", "MIDFIELD", ["GOAL", "KICK", "PITCH", "WHISTLE", "PASS", "CORNER", "STRIKER", "CLEAT", "REFEREE", "SCORE", "DRIBBLE", "NET"]),
    ("Basketball", "REBOUND", ["HOOP", "DRIBBLE", "COURT", "DUNK", "WHISTLE", "PASS", "JERSEY", "BENCH", "GUARD", "SHOOT", "BUZZER", "FOUL"]),
    ("Baseball game", "DIAMOND", ["PITCH", "GLOVE", "BAT", "BASE", "INNING", "CATCHER", "DUGOUT", "MOUND", "HOMER", "STRIKE", "UMPIRE", "FIELD"]),
    ("Tennis match", "RACKET", ["SERVE", "VOLLEY", "COURT", "NET", "ACE", "RALLY", "LOVE", "DOUBLES", "SPIN", "MATCH", "LINE", "BOUNCE"]),
    ("Swimming pool", "BACKSTROKE", ["LANE", "GOGGLES", "DIVE", "SPLASH", "FLOAT", "KICK", "LAP", "TOWEL", "CHLORINE", "WHISTLE", "RELAY", "STROKE"]),
    ("Track and field", "HURDLES", ["SPRINT", "RELAY", "BATON", "LANE", "FINISH", "STRIDE", "TRACK", "PACE", "JAVELIN", "VAULT", "STARTER", "LAP"]),
    ("Winter sports", "SNOWBOARD", ["SKI", "SLOPE", "LODGE", "BOOTS", "POLE", "CHAIRLIFT", "POWDER", "JUMP", "GOGGLE", "TRAIL", "FROST", "CARVE"]),
    ("Gym workout", "DUMBBELL", ["BENCH", "SQUAT", "TREADMILL", "SWEAT", "REPS", "LUNGE", "BARBELL", "COACH", "PLANK", "LIFT", "PULSE", "STRETCH"]),
    ("Yoga class", "MEDITATE", ["POSE", "BREATH", "MAT", "STRETCH", "BALANCE", "CALM", "LOTUS", "FLOW", "STILL", "FOCUS", "POSTURE", "CENTER"]),
    ("Cycling", "HANDLEBAR", ["PEDAL", "CHAIN", "HELMET", "GEAR", "SPOKE", "SADDLE", "BRAKE", "TRAIL", "SPEED", "WHEEL", "COAST", "RIDE"]),
    ("Orchestra", "SYMPHONY", ["VIOLIN", "CELLO", "FLUTE", "HORN", "DRUM", "BATON", "SCORE", "STAGE", "TEMPO", "CHORD", "RHYTHM", "SECTION"]),
    ("Rock band", "GUITARIST", ["AMP", "DRUM", "STAGE", "CHORD", "RIFF", "MIC", "TOUR", "CROWD", "ENCORE", "BASS", "SOLO", "LYRIC", "AMPLIFIER", "VOCALIST", "CONCERT"]),
    ("Jazz club", "SAXOPHONE", ["TRUMPET", "PIANO", "DRUM", "SWING", "SOLO", "STAGE", "BASS", "RHYTHM", "NOTE", "TEMPO", "CLUB", "GROOVE"]),
    ("Ballet", "PIROUETTE", ["DANCER", "STAGE", "LEAP", "SPIN", "BARRE", "POSE", "GRACE", "TUTU", "MUSIC", "RECITAL", "POINTE", "GLIDE"]),
    ("Theater", "REHEARSAL", ["STAGE", "ACTOR", "SCRIPT", "CURTAIN", "PROP", "CUE", "SCENE", "LIGHT", "AUDIENCE", "ENCORE", "DRAMA", "SPOTLIGHT"]),
    ("Film set", "DIRECTOR", ["CAMERA", "SCRIPT", "SCENE", "ACTOR", "LIGHT", "TAKE", "CUT", "EDIT", "SOUND", "CROWD", "FRAME", "ACTION"]),
    ("Museum", "EXHIBIT", ["GALLERY", "ARTIFACT", "CURATOR", "DISPLAY", "TOUR", "PAINTING", "SCULPTURE", "GUIDE", "PLAQUE", "HALL", "RELIC", "GLASS"]),
    ("Library visit", "CATALOG", ["SHELF", "BOOK", "QUIET", "AISLE", "DESK", "STAMP", "RETURN", "NOVEL", "READER", "STUDY", "PAGE", "ARCHIVE"]),
    ("Poetry night", "METAPHOR", ["VERSE", "RHYME", "STANZA", "MIC", "READER", "WORDS", "MEANING", "IMAGE", "LINE", "SPEAK", "PAUSE", "VOICE"]),
    ("Comic books", "SUPERHERO", ["PANEL", "CAPE", "VILLAIN", "ISSUE", "ARTIST", "INK", "HERO", "POWER", "SKETCH", "STORY", "ACTION", "COVER"]),
    ("Chemistry lab", "BEAKER", ["FLASK", "ACID", "BUBBLE", "GLOVE", "FORMULA", "REACT", "VAPOR", "MIXTURE", "SCALE", "LABEL", "GOGGLES", "BURNER"]),
    ("Astronomy", "TELESCOPE", ["STAR", "ORBIT", "COMET", "PLANET", "GALAXY", "MOON", "LENS", "NEBULA", "COSMOS", "SKY", "ECLIPSE", "CRATER"]),
    ("Robotics", "CIRCUIT", ["WIRE", "SENSOR", "MOTOR", "GEAR", "BATTERY", "CODE", "SCREW", "CHIP", "SPARK", "BUILD", "PROGRAM", "SWITCH"]),
    ("Computer lab", "KEYBOARD", ["MOUSE", "SCREEN", "CURSOR", "BROWSER", "FOLDER", "CODE", "CABLE", "MONITOR", "MEMORY", "PIXEL", "WINDOW"]),
    ("Weather station", "BAROMETER", ["GAUGE", "WIND", "CLOUD", "FORECAST", "RADAR", "TEMP", "RAIN", "STORM", "PRESSURE", "CHART", "SATELLITE", "DATA"]),
    ("Geology dig", "SEDIMENT", ["ROCK", "LAYER", "FOSSIL", "MINERAL", "QUARTZ", "ERODE", "CRYSTAL", "STRATA", "SHOVEL", "SAMPLE", "CANYON", "PLATE"]),
    ("Marine biology", "PLANKTON", ["CORAL", "CURRENT", "SPECIMEN", "TIDE", "ALGAE", "REEF", "SAMPLE", "DEPTH", "SONAR", "FIN", "HABITAT", "SPECIES"]),
    ("Space mission", "ASTRONAUT", ["ROCKET", "ORBIT", "LAUNCH", "CREW", "CAPSULE", "GRAVITY", "FUEL", "MODULE", "SHUTTLE", "SUIT", "MISSION", "THRUST"]),
    ("Wind farm", "TURBINE", ["BLADE", "ENERGY", "BREEZE", "TOWER", "POWER", "GRID", "ROTOR", "GENERATE", "CURRENT", "SPIN", "FIELD", "VOLTAGE"]),
    ("Recycling center", "COMPOST", ["BOTTLE", "PLASTIC", "SORT", "BIN", "REUSE", "WASTE", "GLASS", "METAL", "PAPER", "CRUSH", "GREEN", "REDUCE"]),
    ("Morning routine", "SUNRISE", ["ALARM", "SHOWER", "COFFEE", "YAWN", "STRETCH", "TOAST", "MIRROR", "BRUSH", "DRESS", "RUSH", "WAKE", "ROUTINE"]),
    ("Office day", "MEETING", ["DESK", "PRINTER", "COFFEE", "MEMO", "CUBICLE", "PHONE", "REPORT", "DEADLINE", "BOSS", "FOLDER", "SCHEDULE"]),
    ("School day", "CLASSROOM", ["DESK", "PENCIL", "LOCKER", "RECESS", "TEACHER", "HOMEWORK", "CHALK", "BACKPACK", "BELL", "LESSON", "NOTEBOOK", "HALLWAY"]),
    ("Grocery run", "CHECKOUT", ["CART", "AISLE", "COUPON", "BASKET", "RECEIPT", "PRODUCE", "SHELF", "CASHIER", "BAG", "LIST", "BUDGET", "SCAN"]),
    ("Birthday party", "CONFETTI", ["BALLOON", "CAKE", "CANDLE", "GIFT", "PARTY", "GUEST", "RIBBON", "WISH", "STREAMER", "SONG", "TREAT", "SURPRISE"]),
    ("Holiday feast", "GATHERING", ["TABLE", "FEAST", "GUEST", "TOAST", "CANDLE", "RECIPE", "PLATTER", "GRAVY", "ROAST", "FAMILY", "KITCHEN", "SEASON"]),
    ("Wedding day", "CEREMONY", ["AISLE", "VOWS", "BOUQUET", "RING", "TOAST", "VEIL", "GUEST", "DANCE", "CAKE", "CHAPEL", "BRIDE", "GROOM"]),
    ("Rainy day", "UMBRELLA", ["PUDDLE", "DRIZZLE", "BOOTS", "RAINCOAT", "GUTTER", "DAMP", "SPLASH", "CLOUD", "DRIP", "SHELTER", "GRAY", "SOAK"]),
    ("Snow day", "SLEDDING", ["SNOWMAN", "MITTEN", "SCARF", "SHOVEL", "FLAKE", "COCOA", "BLANKET", "FROST", "IGLOO", "BOOTS", "CHILL", "DRIFT"]),
    ("Lazy Sunday", "HAMMOCK", ["BLANKET", "NOVEL", "NAP", "PORCH", "BREEZE", "COFFEE", "QUIET", "SUNLIGHT", "PILLOW", "REST", "SLOW", "DRIFT"]),
    ("Chocolate shop", "TRUFFLE", ["COCOA", "CARAMEL", "WRAPPER", "MELT", "SWEET", "MOLD", "DRIZZLE", "FUDGE", "PRALINE", "BOX", "SILKY", "BAR"]),
    ("Wine tasting", "VINEYARD", ["GRAPE", "BARREL", "CORK", "GLASS", "SWIRL", "TASTE", "CELLAR", "HARVEST", "BOTTLE", "POUR", "TANNIN", "VINE"]),
    ("Sushi bar", "CHOPSTICKS", ["RICE", "ROLL", "WASABI", "SOY", "NORI", "TUNA", "GINGER", "PLATTER", "KNIFE", "FRESH", "SLICE", "MAT"]),
    ("Taco night", "TORTILLA", ["SALSA", "CHEESE", "LIME", "CILANTRO", "SPICE", "ONION", "PEPPER", "FILLING", "FOLD", "GRILL", "FRESH", "WRAP"]),
    ("Pasta dinner", "SPAGHETTI", ["SAUCE", "NOODLE", "GARLIC", "BASIL", "CHEESE", "BOIL", "SIMMER", "TWIRL", "PLATE", "HERB", "TOMATO", "RECIPE"]),
    ("Cheese board", "CHEDDAR", ["CRACKER", "GRAPE", "WINE", "SLICE", "RIND", "PLATTER", "KNIFE", "TASTE", "NUTS", "PAIRING", "BOARD", "FRESH"]),
    ("Smoothie bar", "BLENDER", ["BANANA", "BERRY", "YOGURT", "ICE", "STRAW", "SPINACH", "MANGO", "HONEY", "SCOOP", "FRESH", "PROTEIN", "BLEND"]),
    ("Popcorn night", "BUTTERY", ["KERNEL", "SALT", "BOWL", "MOVIE", "CRUNCH", "POP", "SNACK", "BUCKET", "WARM", "SALTY", "CARAMEL", "TOSS"]),
    ("Candy store", "LOLLIPOP", ["GUMMY", "WRAPPER", "SWEET", "JAR", "TAFFY", "MINT", "CHEWY", "SUGAR", "TREAT", "COLORFUL", "STICKY", "SHELF"]),
    ("Diner breakfast", "OMELET", ["BACON", "HASH", "TOAST", "SYRUP", "COFFEE", "BOOTH", "MENU", "WAITER", "GRIDDLE", "JUICE", "STACK", "BUTTER"]),
    ("Pond life", "DRAGONFLY", ["FROG", "LILY", "POND", "REED", "RIPPLE", "TURTLE", "DUCK", "MOSS", "TADPOLE", "SHORE", "CROAK", "MURKY"]),
    ("Forest hike", "UNDERGROWTH", ["PINE", "TRAIL", "MOSS", "ROOT", "BRANCH", "CANOPY", "LEAF", "TRUNK", "SHADE", "CREEK", "RUSTLE", "THICKET"]),
    ("Savanna", "GIRAFFE", ["LION", "ZEBRA", "GRASS", "HERD", "ACACIA", "DUST", "PRIDE", "ROAM", "HUNT", "PLAIN", "HORIZON"]),
    ("Coral reef", "ANEMONE", ["CORAL", "FISH", "CURRENT", "DIVER", "TIDE", "KELP", "SHELL", "REEF", "SPONGE", "LAGOON", "DEPTH", "COLORFUL"]),
    ("Butterfly garden", "CATERPILLAR", ["COCOON", "WING", "NECTAR", "POLLEN", "FLOWER", "FLUTTER", "CHRYSALIS", "PETAL", "GARDEN", "LARVA", "PERCH", "DELICATE"]),
    ("Beehive", "HONEYCOMB", ["BUZZ", "POLLEN", "QUEEN", "SWARM", "NECTAR", "HIVE", "STING", "WAX", "WORKER", "FLOWER", "DRONE", "COLONY"]),
    ("Wolf pack", "HOWLING", ["FOREST", "PREY", "HUNT", "DEN", "ALPHA", "MOON", "PROWL", "PACK", "FANG", "TRAIL", "GROWL", "TERRITORY"]),
    ("Owl nest", "NOCTURNAL", ["FEATHER", "TALON", "PERCH", "HOOT", "BRANCH", "PREY", "SILENT", "WING", "HUNT", "MOON", "ROOST", "SWOOP"]),
    ("Backyard squirrels", "CHIPMUNK", ["ACORN", "NEST", "BRANCH", "TAIL", "SCAMPER", "BURY", "TREE", "NIBBLE", "HOLLOW", "LEAP", "FOREST", "STASH"]),
    ("Beaver dam", "RIVERBANK", ["DAM", "LODGE", "STREAM", "GNAW", "BRANCH", "POND", "LOG", "BUILD", "WATER", "TAIL", "CURRENT", "MUD"]),
    ("Lighthouse", "SHORELINE", ["BEACON", "ROCKS", "TOWER", "WAVES", "KEEPER", "FOG", "SIGNAL", "CLIFF", "COAST", "HARBOR", "STORM", "GUIDE"]),
    ("Ski resort", "CHAIRLIFT", ["SLOPE", "POWDER", "LODGE", "GOGGLE", "BOOTS", "TRAIL", "PEAK", "FROST", "CARVE", "GONDOLA", "GEAR", "RESORT"]),
    ("National park", "RANGER", ["TRAIL", "CANYON", "WILDLIFE", "CAMP", "PEAK", "RIVER", "FOREST", "PERMIT", "OVERLOOK", "HIKE", "GUIDE", "WILDERNESS"]),
    ("Small town", "DOWNTOWN", ["DINER", "PORCH", "SQUARE", "NEIGHBOR", "PARADE", "BAKERY", "CHURCH", "GAZEBO", "SHOP", "QUIET", "LOCAL", "GATHER"]),
    ("Big city", "SKYSCRAPER", ["SUBWAY", "TAXI", "CROWD", "AVENUE", "TRAFFIC", "NEON", "ALLEY", "CROSSWALK", "BLOCK", "RUSH", "DISTRICT", "PLAZA"]),
    ("Countryside farm", "ORCHARD", ["BARN", "TRACTOR", "FIELD", "HARVEST", "FENCE", "CROP", "SILO", "PASTURE", "HAYSTACK", "PLOW", "MEADOW", "IRRIGATE"]),
    ("Riverside", "CURRENT", ["STREAM", "BANK", "PEBBLE", "RIPPLE", "FISH", "BRIDGE", "FLOW", "REED", "ROCK", "PADDLE", "SHALLOW", "DRIFT"]),
    ("Canyon trail", "ECHOING", ["CLIFF", "RIDGE", "GORGE", "TRAIL", "DUST", "RIVER", "OVERLOOK", "RUGGED", "VISTA", "ROCK", "WINDING", "VAST"]),
    ("Alpine village", "CHALET", ["SNOW", "PEAK", "PINE", "VALLEY", "BELL", "MEADOW", "GOAT", "TRAIL", "FROST", "LODGE", "QUAINT", "SLOPE"]),
    ("Harbor town", "FISHERMAN", ["DOCK", "BOAT", "NET", "TIDE", "GULL", "PIER", "ANCHOR", "CRATE", "WHARF", "SALT", "ROPE", "MARKET", "TRAWLER", "LOBSTER", "SEAGULL"]),
    ("Baking contest", "FROSTING", ["CAKE", "WHISK", "BATTER", "OVEN", "JUDGE", "RECIPE", "LAYER", "SPRINKLE", "RIBBON", "TIMER", "DECORATE", "RISE"]),
    ("Gardening club", "MULCHING", ["TROWEL", "COMPOST", "PRUNE", "BLOOM", "SPROUT", "SEEDLING", "WATER", "SUNLIGHT", "WEED", "HARVEST", "PLANTER", "GROW"]),
    ("Model building", "BLUEPRINT", ["GLUE", "PIECE", "SCALE", "PAINT", "DETAIL", "ASSEMBLE", "KIT", "BRUSH", "PATIENCE", "CRAFT", "PLASTIC", "DESIGN"]),
    ("Origami", "FOLDING", ["PAPER", "CRANE", "CREASE", "SQUARE", "DESIGN", "PATTERN", "PRECISE", "SHAPE", "DIAGONAL", "PLEAT", "TRIANGLE", "ART"]),
    ("Scrapbooking", "KEEPSAKE", ["PHOTO", "GLUE", "STICKER", "LAYOUT", "RIBBON", "MEMORY", "PAGE", "TRIM", "JOURNAL", "DECORATE", "CAPTION", "ALBUM"]),
    ("Beekeeping", "APIARY", ["HIVE", "SMOKER", "VEIL", "FRAME", "HONEY", "COMB", "SWARM", "WORKER", "EXTRACT", "COLONY", "STING", "HARVEST"]),
    ("Backyard astronomy", "TRIPOD", ["TELESCOPE", "PLANET", "ECLIPSE", "COMET", "ORBIT", "NEBULA", "BINOCULARS", "DARKNESS", "CHART", "NIGHT", "STARGAZER", "LENS"]),
    ("Bird photography", "TELEPHOTO", ["BINOCULARS", "PERCH", "FEATHER", "SHUTTER", "BLIND", "PATIENCE", "WING", "FOCUS", "MIGRATE", "NEST", "CAPTURE", "QUIET"]),
    ("Amateur radio", "FREQUENCY", ["ANTENNA", "SIGNAL", "STATIC", "BROADCAST", "DIAL", "TRANSMIT", "CHANNEL", "VOLUME", "TOWER", "RECEIVE", "MORSE", "WAVE"]),
    ("Kite flying", "CROSSWIND", ["STRING", "TAIL", "BREEZE", "LAUNCH", "SOAR", "SPOOL", "FRAME", "GLIDE", "TUG", "SKY", "ANCHOR", "FLUTTER"]),
    ("Yard sale", "BARGAIN", ["TABLE", "PRICE", "HAGGLE", "SIGN", "CROWD", "TREASURE", "BOX", "TAG", "EARLY", "NEIGHBOR", "DEAL", "CLUTTER"]),
    ("Flea market", "VENDOR", ["STALL", "ANTIQUE", "TRINKET", "HAGGLE", "BOOTH", "CROWD", "TREASURE", "COIN", "RELIC", "BROWSE", "TABLE", "BARGAIN"]),
    ("Farmers almanac", "FORECAST", ["SEASON", "HARVEST", "MOON", "WEATHER", "PLANT", "FROST", "RAIN", "CYCLE", "TIDE", "CALENDAR", "PATTERN", "SIGN"]),
    ("Recycling day", "CURBSIDE", ["BIN", "SORT", "BOTTLE", "CARDBOARD", "PICKUP", "TRUCK", "GLASS", "PLASTIC", "CRATE", "HAUL", "WEEKLY", "ROUTE"]),
    ("Neighborhood watch", "PATROL", ["STREET", "PORCH", "FLASHLIGHT", "ALERT", "NEIGHBOR", "GATE", "RADIO", "SAFETY", "WALK", "CORNER", "VIGIL", "REPORT"]),
    ("Block party", "STREAMER", ["GRILL", "NEIGHBOR", "MUSIC", "TABLE", "BALLOON", "GAME", "POTLUCK", "CHAIR", "GATHER", "SUMMER", "FEAST", "DANCE"]),
    ("Book club", "DISCUSSION", ["NOVEL", "CHAPTER", "CRITIQUE", "MEMBER", "PLOT", "CHARACTER", "THEME", "MEETING", "PAGE", "ANALYZE", "OPINION", "SHARE"]),
    ("Trivia night", "QUESTION", ["ANSWER", "BUZZER", "TEAM", "ROUND", "SCORE", "HOST", "CATEGORY", "POINT", "GUESS", "TABLE", "PRIZE", "CLEVER"]),
    ("Karaoke night", "MICROPHONE", ["LYRICS", "STAGE", "SCREEN", "CROWD", "SONG", "APPLAUSE", "DUET", "TUNE", "SPOTLIGHT", "VERSE", "ENCORE", "NERVOUS"]),
    ("Game night", "SCOREBOARD", ["DICE", "CARDS", "TIMER", "TEAM", "ROUND", "LAUGHTER", "TABLE", "RULES", "WINNER", "SNACK", "STRATEGY", "PLAYER"]),
    # ---- v2 additions, curated the same way: real dictionary words only ----
    ("Ice hockey", "HOCKEY", ["PUCK", "RINK", "SKATE", "STICK", "GOALIE", "HELMET", "JERSEY", "WHISTLE", "PENALTY", "BLADE", "CREASE", "COACH", "REFEREE", "ROSTER"]),
    ("Amusement park", "CARNIVAL", ["RIDE", "TICKET", "COASTER", "WHEEL", "TUNNEL", "BOOTH", "PRIZE", "BALLOON", "CROWD", "LIGHTS", "GAMES", "QUEUE"]),
    ("Aquarium visit", "DOLPHIN", ["TANK", "GLASS", "DIVER", "OTTER", "JELLYFISH", "STINGRAY", "PENGUIN", "EXHIBIT", "BUBBLE", "CORAL", "SHARK", "GUIDE"]),
    ("Planetarium", "GALAXY", ["STAR", "DOME", "PROJECTOR", "COSMOS", "ORBIT", "COMET", "NEBULA", "UNIVERSE", "TELESCOPE", "DARKNESS", "SEATS", "SHOW"]),
    ("Farm stand", "ROADSIDE", ["STAND", "CROPS", "BASKET", "PRODUCE", "TOMATO", "CORN", "PUMPKIN", "HONEY", "JAM", "EGGS", "FLOWERS", "SIGN"]),
    ("County fair", "MIDWAY", ["RIDES", "GAMES", "PRIZE", "LIVESTOCK", "PIE", "RIBBON", "TRACTOR", "BOOTH", "FUNNEL", "CROWD", "TICKET", "STAGE"]),
    ("Skate park", "GRINDING", ["RAMP", "RAIL", "BOARD", "WHEELS", "HELMET", "TRICK", "JUMP", "BOWL", "CONCRETE", "FLIP", "LEDGE", "SPIN"]),
    ("Roller rink", "SKATING", ["WHEELS", "DISCO", "LACES", "RINK", "MUSIC", "GLIDE", "LIMBO", "RENTAL", "FLOOR", "LIGHTS", "TURN"]),
    ("Bowling alley", "STRIKE", ["LANE", "PIN", "BALL", "GUTTER", "SCORE", "FRAME", "SPARE", "SHOE", "GLOVE", "GRIP", "GAME", "GLOSSY"]),
    ("Arcade night", "JOYSTICK", ["TOKEN", "SCORE", "PIXEL", "CABINET", "BUTTON", "LEVEL", "PRIZE", "CLAW", "SCREEN", "GAME", "HIGH", "COMBO"]),
    ("Food truck", "TAKEOUT", ["MENU", "WINDOW", "GRILL", "NAPKIN", "LINE", "SAUCE", "ORDER", "CASH", "PARKED", "SIZZLE", "TRUCK", "CRAVING"]),
    ("Diner counter", "GRIDDLE", ["COFFEE", "MENU", "STOOL", "WAITER", "SYRUP", "HASH", "TOAST", "JUKEBOX", "BOOTH", "PIE", "COUNTER", "REFILL"]),
    ("Campsite morning", "DAYBREAK", ["DEW", "MIST", "COFFEE", "TENT", "EMBERS", "CHILL", "STRETCH", "KETTLE", "TRAIL", "QUIET", "GOLDEN", "HORIZON"]),
    ("Lake cabin", "LAKESIDE", ["CANOE", "DOCK", "LOON", "RIPPLE", "PORCH", "FISHING", "SUNSET", "PADDLE", "CABIN", "QUIET", "PINE", "WATER"]),
    ("Mountain lodge", "ALPINE", ["LODGE", "SNOW", "PEAK", "FIRE", "COCOA", "BLANKET", "SKI", "TIMBER", "RUSTIC", "WARM", "VIEW", "CHALET"]),
    ("City park", "PLAYGROUND", ["BENCH", "SWING", "PATH", "FOUNTAIN", "JOGGER", "TREES", "PICNIC", "DOG", "KITE", "SHADE", "POND", "GRASS"]),
    ("Dog park", "RETRIEVE", ["LEASH", "BALL", "FENCE", "BREED", "SNIFF", "BARK", "ROMP", "PUDDLE", "TREAT", "COLLAR", "RUN", "TAIL"]),
    ("Farmers coop", "CREAMERY", ["MILK", "CHURN", "BUTTER", "CHEESE", "DAIRY", "FARM", "BOTTLE", "CRATE", "DELIVERY", "FRESH", "COOLER", "TRUCK"]),
    ("Greenhouse", "SEEDLING", ["SOIL", "POT", "WATER", "SPROUT", "GLASS", "SUNLIGHT", "TRAY", "LABEL", "TROWEL", "HUMID", "SHELF", "GROW"]),
    ("Vineyard tour", "GRAPEVINE", ["BARREL", "CORK", "TASTE", "ROW", "HARVEST", "CELLAR", "SUNSET", "HILLSIDE", "POUR", "SWIRL", "ESTATE"]),
    ("Brewery tour", "FERMENT", ["HOPS", "BARLEY", "KEG", "TAP", "YEAST", "VAT", "BOTTLE", "TASTING", "FLIGHT", "FOAM", "MALT", "BREW"]),
    ("Distillery", "WHISKEY", ["BARREL", "MASH", "STILL", "OAK", "PROOF", "AGING", "BOTTLE", "LABEL", "SMOKY", "GRAIN", "POUR", "CASK"]),
    ("Coffee roastery", "ROASTING", ["BEANS", "DRUM", "SMOKE", "AROMA", "BATCH", "GRIND", "COOLING", "SAMPLE", "CUP", "DARK", "BLEND", "CRACK"]),
    ("Bakery kitchen", "KNEADING", ["DOUGH", "FLOUR", "OVEN", "YEAST", "RISE", "PROOF", "SHAPE", "BENCH", "TIMER", "BATCH", "CRUST", "STEAM"]),
    ("Butcher shop", "CLEAVER", ["KNIFE", "COUNTER", "SCALE", "WRAP", "CUT", "PRIME", "SAUSAGE", "GRIND", "FRESH", "BLOCK", "APRON", "ORDER"]),
    ("Fish market", "SEAFOOD", ["ICE", "CRATE", "SCALE", "FILLET", "SHRIMP", "CRAB", "LOBSTER", "VENDOR", "FRESH", "STALL", "COUNTER", "CATCH"]),
    ("Spice market", "TURMERIC", ["CUMIN", "PEPPER", "STALL", "SACK", "AROMA", "BLEND", "VENDOR", "POWDER", "JAR", "SCOOP", "MARKET", "COLOR"]),
    ("Toy store", "PUZZLES", ["BLOCKS", "DOLLS", "ROBOT", "GAME", "SHELF", "WRAP", "AISLE", "KIDS", "COLORFUL", "BOXED", "DISPLAY", "CART"]),
    ("Hardware store", "FASTENER", ["NAILS", "SCREWS", "PAINT", "LADDER", "AISLE", "WRENCH", "BOLT", "HINGE", "CART", "SIGN", "COUNTER", "LUMBER"]),
    ("Bike shop", "MECHANIC", ["CHAIN", "GEAR", "TIRE", "PEDAL", "WRENCH", "TUBE", "HELMET", "RACK", "REPAIR", "GREASE", "SPOKE", "PUMP"]),
]

# Which curated themes go to which difficulty. Anything not listed in
# EASY_NAMES or HARD_NAMES falls to medium. Kept as explicit name lists
# (not index slices) so re-ordering THEMES above never silently reshuffles
# a difficulty's pool.
EASY_NAMES = frozenset({
    "Coffee shop", "Bakery case", "Pizza night", "Breakfast table", "Farmers market",
    "Ice cream shop", "Tea time", "Backyard barbecue", "Salad bar", "Soup kitchen",
    "Camping trip", "Beach day", "Winter storm", "Thunderstorm", "Garden bed",
    "Autumn walk", "Spring thaw", "Farm animals", "Bird watching", "Big cats",
    "Ocean depths", "Dog breeds", "Cat behavior", "Zoo visit", "Laundry day",
    "Spring cleaning", "Bedroom", "Living room", "Bathroom", "Toolshed",
    "Attic clutter", "Moving day", "Home repair", "Road trip", "Airport",
    "Train ride", "City streets", "Countryside", "Island getaway", "Mountain town",
    "Desert town", "Chess club", "Board games", "Card games", "Jigsaw puzzles",
    "Soccer match", "Basketball", "Baseball game", "Tennis match", "Swimming pool",
    "Grocery run", "Birthday party", "Holiday feast", "Wedding day", "Rainy day",
    "Snow day", "Lazy Sunday", "Chocolate shop", "Popcorn night", "Candy store",
})

HARD_NAMES = frozenset({
    "Mountain climb", "Rainforest canopy", "Desert trek", "Insect world", "Reptile house",
    "Arctic wildlife", "Sewing kit", "Sailing trip", "Road signs", "Painter's studio",
    "Pottery class", "Knitting circle", "Photography", "Bookbinding", "Woodworking",
    "Track and field", "Winter sports", "Gym workout", "Yoga class", "Cycling",
    "Orchestra", "Rock band", "Jazz club", "Ballet", "Theater",
    "Film set", "Museum", "Library visit", "Poetry night", "Comic books",
    "Chemistry lab", "Astronomy", "Robotics", "Computer lab", "Weather station",
    "Geology dig", "Marine biology", "Space mission", "Wind farm", "Recycling center",
    "Baking contest", "Gardening club", "Model building", "Origami", "Scrapbooking",
    "Beekeeping", "Backyard astronomy", "Bird photography", "Kite flying",
    "Planetarium", "Vineyard tour", "Brewery tour", "Distillery", "Coffee roastery",
    "Bakery kitchen", "Spice market", "Aquarium visit", "Greenhouse", "Farmers coop",
})


def load_wordset():
    words = set()
    with open(WORDLIST_PATH, encoding="utf-8") as f:
        for line in f:
            w = line.strip()
            if w:
                words.add(w)
    return words


def validate_themes(wordset):
    """Returns (clean_themes, problems). Pool words shorter than
    MIN_WORD_LEN are silently dropped (they were only ever extra
    subset-sum flexibility). A theme is dropped outright if its spangram
    is bad, or a pool word is misspelled/duplicated/has a space."""
    clean = []
    problems = []
    seen_spangrams = set()
    seen_names = set()
    for theme, spangram, pool in THEMES:
        bad = []
        if theme in seen_names:
            bad.append(f"duplicate theme name {theme}")
        if spangram in seen_spangrams:
            bad.append(f"duplicate spangram {spangram}")
        if not (6 <= len(spangram) <= 11):
            bad.append(f"spangram length {len(spangram)}")
        if spangram.lower() not in wordset:
            bad.append(f"spangram {spangram} not in dictionary")
        seen = {spangram}
        kept_pool = []
        for w in pool:
            if " " in w:
                bad.append(f"{w} has a space")
                continue
            if len(w) < MIN_WORD_LEN:
                continue
            if w.lower() not in wordset:
                bad.append(f"{w} not in dictionary")
                continue
            if w in seen:
                bad.append(f"duplicate word {w}")
                continue
            seen.add(w)
            kept_pool.append(w)
        if bad:
            problems.append((theme, bad))
        else:
            seen_spangrams.add(spangram)
            seen_names.add(theme)
            clean.append((theme, spangram, kept_pool))
    return clean, problems


# ---------------------------------------------------------------------
# Hamiltonian path over the king-move grid graph
# ---------------------------------------------------------------------

def neighbors(r, c, rows, cols):
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols:
                yield (nr, nc)


def build_hamiltonian_path(rng, start, rows, cols, max_steps=20000):
    """Randomized Warnsdorff-heuristic DFS. Returns a list of all rows*cols
    cells in visiting order (consecutive cells always king-adjacent), or
    None if it could not complete within max_steps backtracking steps."""
    total = rows * cols
    visited = {start}
    path = [start]
    steps = [0]

    def degree(cell):
        r, c = cell
        return sum(1 for n in neighbors(r, c, rows, cols) if n not in visited)

    def dfs():
        steps[0] += 1
        if steps[0] > max_steps:
            return False
        if len(path) == total:
            return True
        r, c = path[-1]
        cands = [n for n in neighbors(r, c, rows, cols) if n not in visited]
        if not cands:
            return False
        scored = [(degree(n), n) for n in cands]
        rng.shuffle(scored)
        scored.sort(key=lambda x: x[0])
        for _, n in scored:
            visited.add(n)
            path.append(n)
            if dfs():
                return True
            path.pop()
            visited.remove(n)
        return False

    return path[:] if dfs() else None


def scan_spangram_windows(path, spanlen, rows, cols):
    """Contiguous windows of the path with the given length whose two ends
    sit on opposite grid edges (left/right or top/bottom)."""
    out = []
    for i in range(0, rows * cols - spanlen + 1):
        a = path[i]
        b = path[i + spanlen - 1]
        if (a[1] == 0 and b[1] == cols - 1) or (a[1] == cols - 1 and b[1] == 0):
            out.append(i)
        elif (a[0] == 0 and b[0] == rows - 1) or (a[0] == rows - 1 and b[0] == 0):
            out.append(i)
    return out


def find_subset_sum(pool, target, max_count, rng, cap=800):
    """pool: list of (word, length). Finds a subset summing to target with
    1..max_count items. Returns a list of words, or None."""
    if target == 0:
        return []
    idxs = list(range(len(pool)))
    found = []
    for count in range(1, max_count + 1):
        for combo in itertools.combinations(idxs, count):
            if sum(pool[i][1] for i in combo) == target:
                found.append(combo)
                if len(found) >= cap:
                    break
        if len(found) >= cap:
            break
    if not found:
        return None
    combo = rng.choice(found)
    return [pool[i][0] for i in combo]


def generate_puzzle(theme_name, spangram, pool_words, rng, rows, cols,
                     min_words=MIN_THEME_WORDS, max_words=MAX_THEME_WORDS, attempts=250):
    spanlen = len(spangram)
    pool_items = [(w, len(w)) for w in pool_words]

    for _ in range(attempts):
        start = (rng.randrange(rows), rng.randrange(cols))
        path = build_hamiltonian_path(rng, start, rows, cols)
        if not path:
            continue
        windows = scan_spangram_windows(path, spanlen, rows, cols)
        if not windows:
            continue
        rng.shuffle(windows)
        for i in windows:
            before_len = i
            after_len = rows * cols - spanlen - i
            group_a = find_subset_sum(pool_items, before_len, 6, rng) if before_len else []
            if group_a is None:
                continue
            remaining = [it for it in pool_items if it[0] not in group_a]
            group_b = find_subset_sum(remaining, after_len, 6, rng) if after_len else []
            if group_b is None:
                continue
            total_words = len(group_a) + len(group_b) + 1
            if not (min_words <= total_words <= max_words):
                continue

            words_a = list(group_a)
            rng.shuffle(words_a)
            words_b = list(group_b)
            rng.shuffle(words_b)

            before_cells = path[0:i]
            spangram_cells = path[i:i + spanlen]
            after_cells = path[i + spanlen:rows * cols]

            assignment = []
            pos = 0
            for w in words_a:
                assignment.append((w, before_cells[pos:pos + len(w)]))
                pos += len(w)
            assignment.append((spangram, spangram_cells))
            pos = 0
            for w in words_b:
                assignment.append((w, after_cells[pos:pos + len(w)]))
                pos += len(w)

            grid = [[None] * cols for _ in range(rows)]
            solution = {}
            for w, cells in assignment:
                for ch, (r, c) in zip(w, cells):
                    grid[r][c] = ch
                solution[w] = [[r, c] for (r, c) in cells]

            if any(grid[r][c] is None for r in range(rows) for c in range(cols)):
                continue

            grid_strs = ["".join(row) for row in grid]
            return {
                "theme": theme_name,
                "spangram": spangram,
                "words": words_a + words_b,
                "grid": grid_strs,
                "solution": solution,
            }
    return None


# ---------------------------------------------------------------------
# Bonus (non-theme) findable words, via a dictionary trie search of the
# finished grid. Computed at build time so the shipped page never needs
# the full wordlist at runtime.
# ---------------------------------------------------------------------

class TrieNode:
    __slots__ = ("children", "is_word")

    def __init__(self):
        self.children = {}
        self.is_word = False


def build_trie(words):
    root = TrieNode()
    for w in words:
        node = root
        for ch in w:
            node = node.children.setdefault(ch, TrieNode())
        node.is_word = True
    return root


def find_bonus_words(grid_strs, trie, exclude, rng, max_len=MAX_BONUS_LEN, cap=MAX_BONUS_PER_PUZZLE):
    rows = len(grid_strs)
    cols = len(grid_strs[0])
    found = set()

    def dfs(r, c, node, visited, letters):
        if len(letters) >= max_len:
            return
        for nr, nc in neighbors(r, c, rows, cols):
            if (nr, nc) in visited:
                continue
            ch = grid_strs[nr][nc].lower()
            child = node.children.get(ch)
            if child is None:
                continue
            new_letters = letters + ch
            if child.is_word and len(new_letters) >= MIN_WORD_LEN:
                upper = new_letters.upper()
                if upper not in exclude:
                    found.add(upper)
            visited.add((nr, nc))
            dfs(nr, nc, child, visited, new_letters)
            visited.remove((nr, nc))

    for r in range(rows):
        for c in range(cols):
            ch = grid_strs[r][c].lower()
            child = trie.children.get(ch)
            if child is None:
                continue
            dfs(r, c, child, {(r, c)}, ch)

    candidates = sorted(w for w in found if w.lower() not in BLOCKLIST)
    if len(candidates) > cap:
        candidates = rng.sample(candidates, cap)
    return sorted(candidates)


# ---------------------------------------------------------------------
# Validation of a finished puzzle (mirrors the invariants pytest checks)
# ---------------------------------------------------------------------

def validate_puzzle(puzzle, rows, cols):
    grid = puzzle["grid"]
    assert len(grid) == rows, f"grid must have {rows} rows"
    assert all(len(row) == cols for row in grid), f"every row must have {cols} columns"

    all_words = [puzzle["spangram"]] + puzzle["words"]
    assert len(all_words) == len(set(all_words)), "duplicate word in puzzle"

    used = set()
    for word in all_words:
        cells = puzzle["solution"][word]
        assert len(cells) == len(word), f"solution length mismatch for {word}"
        prev = None
        for (r, c), ch in zip(cells, word):
            assert 0 <= r < rows and 0 <= c < cols, "cell out of bounds"
            assert grid[r][c] == ch, f"grid/solution letter mismatch for {word}"
            cell_key = (r, c)
            assert cell_key not in used, f"cell {cell_key} used twice"
            used.add(cell_key)
            if prev is not None:
                pr, pc = prev
                assert abs(pr - r) <= 1 and abs(pc - c) <= 1, f"non-adjacent step in {word}"
            prev = (r, c)

    assert len(used) == rows * cols, "grid is not fully tiled"

    span_cells = puzzle["solution"][puzzle["spangram"]]
    a, b = span_cells[0], span_cells[-1]
    touches_h = (a[1] == 0 and b[1] == cols - 1) or (a[1] == cols - 1 and b[1] == 0)
    touches_v = (a[0] == 0 and b[0] == rows - 1) or (a[0] == rows - 1 and b[0] == 0)
    assert touches_h or touches_v, "spangram does not span two opposite edges"


def build_section(themes, rows, cols, seed, trie, min_words=MIN_THEME_WORDS, max_words=MAX_THEME_WORDS):
    puzzles = []
    failed = []
    for theme_name, spangram, pool in themes:
        rng = random.Random(f"{seed}:{rows}x{cols}:{theme_name}")
        puzzle = generate_puzzle(theme_name, spangram, pool, rng, rows, cols,
                                  min_words=min_words, max_words=max_words)
        if puzzle is None:
            failed.append(theme_name)
            continue
        validate_puzzle(puzzle, rows, cols)
        exclude = {puzzle["spangram"]} | set(puzzle["words"])
        bonus_rng = random.Random(f"{seed}:{rows}x{cols}:{theme_name}:bonus")
        puzzle["bonusWords"] = find_bonus_words(puzzle["grid"], trie, exclude, bonus_rng)
        puzzles.append(puzzle)

    grids_seen = set()
    dedup = []
    for p in puzzles:
        key = tuple(p["grid"])
        if key in grids_seen:
            continue
        grids_seen.add(key)
        dedup.append(p)

    return dedup, failed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=20260810)
    parser.add_argument("--out", default=str(OUT_PATH))
    args = parser.parse_args()

    wordset = load_wordset()
    clean_themes, problems = validate_themes(wordset)
    if problems:
        print(f"Skipping {len(problems)} malformed theme(s):", file=sys.stderr)
        for name, bad in problems:
            print(f"  {name}: {'; '.join(bad)}", file=sys.stderr)

    trie_words = [w for w in wordset if MIN_WORD_LEN <= len(w) <= MAX_BONUS_LEN]
    trie = build_trie(trie_words)

    easy_themes = [t for t in clean_themes if t[0] in EASY_NAMES]
    hard_themes = [t for t in clean_themes if t[0] in HARD_NAMES]
    medium_themes = [t for t in clean_themes if t[0] not in EASY_NAMES and t[0] not in HARD_NAMES]

    easy_puzzles, easy_failed = build_section(easy_themes, EASY_ROWS, EASY_COLS, args.seed, trie)
    medium_puzzles, medium_failed = build_section(medium_themes, STD_ROWS, STD_COLS, args.seed, trie)
    hard_puzzles, hard_failed = build_section(
        hard_themes, STD_ROWS, STD_COLS, args.seed, trie,
        min_words=HARD_MIN_THEME_WORDS, max_words=MAX_THEME_WORDS,
    )

    for label, failed in (("easy", easy_failed), ("medium", medium_failed), ("hard", hard_failed)):
        if failed:
            print(f"Could not place {len(failed)} {label} theme(s): {', '.join(failed)}", file=sys.stderr)

    bank = {
        "easy": {"puzzles": easy_puzzles},
        "medium": {"puzzles": medium_puzzles},
        "hard": {"puzzles": hard_puzzles},
    }
    out_path = Path(args.out)
    out_path.write_text(json.dumps(bank, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {len(easy_puzzles)} easy, {len(medium_puzzles)} medium, {len(hard_puzzles)} hard puzzles to {out_path}")
    for label, puzzles in (("easy", easy_puzzles), ("medium", medium_puzzles), ("hard", hard_puzzles)):
        if len(puzzles) < MIN_BANK_SIZE:
            print(f"WARNING: {label} bank has only {len(puzzles)} puzzles, below the {MIN_BANK_SIZE} target.", file=sys.stderr)


if __name__ == "__main__":
    main()
