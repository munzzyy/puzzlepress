// Words the big public dictionaries accept that don't belong in a family
// puzzle. Games drop these at play time, so they are never accepted, counted,
// hinted or revealed. tools/blocklist.py must match (tests/test_blocklist.py).
export const BLOCKED_WORDS = new Set([
  "anal", "anus", "anuses", "arse", "arses", "ass", "asses", "bastard", "bastards",
  "bitch", "bitches", "bong", "bongs", "boob", "boobs", "bugger", "buggers", "chink",
  "chinks", "chinky", "cock", "cocks", "coon", "coons", "crap", "crappy", "craps",
  "cunt", "cunts", "damn", "damned", "damns", "dick", "dicks", "dildo", "dildoes",
  "dildos", "dyke", "dykes", "dykey", "erotic", "erotica", "fag", "faggot", "faggots",
  "fags", "fetish", "gook", "gooks", "homo", "homos", "hooker", "hookers", "horny",
  "incest", "kike", "kikes", "kinky", "meth", "meths", "moron", "morons", "nazi",
  "nazis", "negro", "negroes", "nigger", "niggers", "nude", "nudes", "orgasm",
  "orgasms", "orgies", "orgy", "penes", "penis", "penises", "pimp", "pimps", "piss",
  "pissed", "porn", "porno", "pornos", "porns", "prick", "pricks", "rape", "raped",
  "raper", "rapers", "rapes", "raping", "rapist", "rapists", "retard", "retarded",
  "retards", "semen", "sex", "sexed", "sexes", "sexy", "shit", "shits", "skank",
  "skanks", "slut", "sluts", "sperm", "spic", "spick", "spicks", "spics", "squaw",
  "tit", "tits", "titty", "tranny", "twat", "twats", "vagina", "vaginas", "wank",
  "wanker", "wetback", "wetbacks", "whore", "whored", "whoredom", "whoredoms",
  "whorehouse", "whorehouses", "whoremaster", "whoremasters", "whoremonger",
  "whoremongers", "whores", "whoreson", "whoresons", "wog", "wogs",
]);
