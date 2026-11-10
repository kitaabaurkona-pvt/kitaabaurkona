// Book search that forgives spelling and script.
//
// A shopper may type a title in English, in Hindi or another Indian script ("एटॉमिक
// हैबिट्स", "தமிழ்"), in Urdu, in Hinglish ("amir pita garib pita"), with typos
// ("atomik habbits", "psycology of mony"), with accents left out ("hector garcia") or
// with the words run together ("harrypotter"). Every query and title is brought to the
// same plain Latin form and to a "sound" form (consonants only, with letters that sound
// alike merged), and the two are compared loosely. The catalogue is small, so the whole
// ranking runs in the browser.
//
// Pure functions only: no network, no React.

// ---------------------------------------------------------------------------------
// 1. Scripts to Latin

// Indian scripts share one layout (from ISCII): the same letter sits at the same
// offset in each Unicode block. One table therefore reads all nine of them.
const INDIC_BLOCKS = [0x0900, 0x0980, 0x0a00, 0x0a80, 0x0b00, 0x0b80, 0x0c00, 0x0c80, 0x0d00];
const BENGALI = 0x0980;

const INDIC_VOWELS = {
  0x04: 'a', 0x05: 'a', 0x06: 'a', 0x07: 'i', 0x08: 'i', 0x09: 'u', 0x0a: 'u', 0x0b: 'ri', 0x0c: 'li',
  0x0d: 'e', 0x0e: 'e', 0x0f: 'e', 0x10: 'ai', 0x11: 'o', 0x12: 'o', 0x13: 'o', 0x14: 'au',
  0x50: 'om', 0x60: 'ri', 0x61: 'li', 0x72: 'i', 0x73: 'u', 0x74: 'o',
};
// Vowel signs written after a consonant (they replace its built-in "a").
const INDIC_SIGNS = {
  0x3a: 'o', 0x3b: 'o', 0x3e: 'a', 0x3f: 'i', 0x40: 'i', 0x41: 'u', 0x42: 'u', 0x43: 'ri', 0x44: 'ri',
  0x45: 'e', 0x46: 'e', 0x47: 'e', 0x48: 'ai', 0x49: 'o', 0x4a: 'o', 0x4b: 'o', 0x4c: 'au', 0x4f: 'o',
  0x56: 'ai', 0x57: 'au', 0x62: 'ri', 0x63: 'li',
};
const INDIC_CONSONANTS = {
  0x15: 'k', 0x16: 'kh', 0x17: 'g', 0x18: 'gh', 0x19: 'n', 0x1a: 'ch', 0x1b: 'chh', 0x1c: 'j', 0x1d: 'jh',
  0x1e: 'n', 0x1f: 't', 0x20: 'th', 0x21: 'd', 0x22: 'dh', 0x23: 'n', 0x24: 't', 0x25: 'th', 0x26: 'd',
  0x27: 'dh', 0x28: 'n', 0x29: 'n', 0x2a: 'p', 0x2b: 'ph', 0x2c: 'b', 0x2d: 'bh', 0x2e: 'm', 0x2f: 'y',
  0x30: 'r', 0x31: 'r', 0x32: 'l', 0x33: 'l', 0x34: 'l', 0x35: 'v', 0x36: 'sh', 0x37: 'sh', 0x38: 's',
  0x39: 'h', 0x58: 'q', 0x59: 'kh', 0x5a: 'g', 0x5b: 'z', 0x5c: 'r', 0x5d: 'rh', 0x5e: 'f', 0x5f: 'y',
  0x70: 'r', 0x71: 'v',
};
// Marks that stand for a nasal or an "h" sound, and the Malayalam letters that end a
// syllable without a vowel.
const INDIC_MARKS = { 0x01: 'n', 0x02: 'n', 0x03: 'h', 0x70: 'n', 0x7a: 'n', 0x7b: 'n', 0x7c: 'r', 0x7d: 'l', 0x7e: 'l', 0x7f: 'k' };
const VIRAMA = 0x4d;
const NUKTA = 0x3c;
const NUKTA_FORMS = { k: 'q', kh: 'kh', g: 'g', j: 'z', d: 'r', dh: 'rh', ph: 'f', y: 'y' };

// Urdu and Arabic letters (short vowels are not written, which suits the sound form).
const ARABIC = {
  'ا': 'a', 'آ': 'a', 'أ': 'a', 'إ': 'i', 'ب': 'b', 'پ': 'p', 'ت': 't', 'ٹ': 't', 'ث': 's', 'ج': 'j',
  'چ': 'ch', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ڈ': 'd', 'ذ': 'z', 'ر': 'r', 'ڑ': 'r', 'ز': 'z', 'ژ': 'zh',
  'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'z', 'ط': 't', 'ظ': 'z', 'ع': '', 'غ': 'gh', 'ف': 'f', 'ق': 'q',
  'ک': 'k', 'ك': 'k', 'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ں': 'n', 'و': 'o', 'ہ': 'h', 'ه': 'h',
  'ھ': 'h', 'ء': '', 'ی': 'i', 'ي': 'i', 'ى': 'a', 'ے': 'e', 'ۓ': 'e', 'ئ': 'i', 'ة': 'a',
};

function indicPart(cp) {
  if (cp < 0x0900 || cp > 0x0d7f) return null;
  const base = INDIC_BLOCKS[Math.floor((cp - 0x0900) / 0x80)];
  return { base, offset: cp - base };
}

// Reads Indian scripts and Urdu as Latin letters; anything else is left alone. A
// consonant carries an "a" unless a vowel sign or a virama follows it; the "a" is
// dropped at the end of a word, as Hindi speakers say it ("चेतन" → "chetan").
export function toLatin(text) {
  let out = '';
  let pendingA = false;
  const flush = (atWordEnd) => {
    if (pendingA && !atWordEnd) out += 'a';
    pendingA = false;
  };
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const cp = ch.codePointAt(0);
    const part = indicPart(cp);
    if (part) {
      const { base, offset } = part;
      if (offset === NUKTA) {
        const match = /(kh|dh|ph|[kgjdy])$/.exec(out);
        if (match && pendingA) out = out.slice(0, -match[1].length) + (NUKTA_FORMS[match[1]] ?? match[1]);
        continue;
      }
      if (offset === VIRAMA) {
        pendingA = false;
        continue;
      }
      if (base === BENGALI && offset === 0x4e) {
        flush(false);
        out += 't';
        continue;
      }
      if (INDIC_SIGNS[offset] !== undefined && pendingA) {
        pendingA = false;
        out += INDIC_SIGNS[offset];
        continue;
      }
      if (INDIC_CONSONANTS[offset] !== undefined && !(offset === 0x70 && base === 0x0a00)) {
        flush(false);
        out += INDIC_CONSONANTS[offset];
        pendingA = true;
        continue;
      }
      if (INDIC_MARKS[offset] !== undefined) {
        flush(false);
        out += INDIC_MARKS[offset];
        continue;
      }
      if (INDIC_VOWELS[offset] !== undefined) {
        flush(false);
        out += INDIC_VOWELS[offset];
        continue;
      }
      if (offset >= 0x66 && offset <= 0x6f) {
        flush(false);
        out += String(offset - 0x66);
        continue;
      }
      // Dandas, accents and other signs.
      flush(true);
      out += offset === 0x64 || offset === 0x65 ? ' ' : '';
      continue;
    }
    if (ARABIC[ch] !== undefined) {
      flush(true);
      out += ARABIC[ch];
      continue;
    }
    // Arabic digits.
    if (cp >= 0x0660 && cp <= 0x0669) {
      flush(true);
      out += String(cp - 0x0660);
      continue;
    }
    if (cp >= 0x06f0 && cp <= 0x06f9) {
      flush(true);
      out += String(cp - 0x06f0);
      continue;
    }
    // Zero-width joiners inside Indian words do not end the word.
    if (cp === 0x200c || cp === 0x200d) continue;
    flush(true);
    out += ch;
  }
  flush(true);
  return out;
}

// ---------------------------------------------------------------------------------
// 2. Plain words

const STOPWORDS = new Set([
  'the', 'of', 'a', 'an', 'and', 'by', 'in', 'on', 'to', 'for', 'with', 'from', 'at', 'is', 'or',
  // Hindi and Hinglish joining words ("द" reads as "d").
  'd', 'da', 'di', 'ka', 'ki', 'ke', 'ko', 'se', 'me', 'mein', 'men', 'aur', 'ek', 'hai', 'hain', 'wala', 'wali', 'vala', 'vali',
  // Words that only say "a book".
  'book', 'books', 'novel', 'novels', 'kitab', 'kitabe', 'kitaben', 'pustak', 'upanyas', 'edition', 'buy', 'online', 'price',
]);

// Lower case Latin letters and digits only, words split by single spaces. Accents are
// removed ("Hergé" → "herge"), apostrophes join ("Can't" → "cant"), "&" is "and".
export function normalize(text) {
  // Indian scripts are read in composed form (a split Tamil "ொ" would read as two
  // vowels); the Latin result is then split so accents can be dropped.
  return toLatin(String(text ?? '').normalize('NFC').toLowerCase())
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’‘`´]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// One spelling for sounds that are written several ways ("aadat" → "adat",
// "habbits" → "habits"), and the plural dropped.
function fold(word) {
  if (/^\d+$/.test(word)) return word;
  let w = word.replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/(.)\1+/g, '$1');
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ches|shes|xes|ses)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1);
  // A final "y" or "ey" is said "i" ("Harry" / "हैरी", "Money" / "मनी").
  if (w.length > 2) w = w.replace(/e?y$/, 'i');
  return w;
}

// The consonants of a word, with letters that sound alike merged, so that the same
// word written in another script or spelled by ear comes out the same:
// "Atomic" / "एटॉमिक" (etomik) → "tmk", "Psychology" / "साइकोलॉजी" (saikoloji) → "sklj".
export function sound(word) {
  if (/^\d+$/.test(word)) return word;
  let w = word
    .replace(/^ps/, 's')
    .replace(/^kn/, 'n')
    .replace(/^wr/, 'r')
    .replace(/w/g, 'v')
    .replace(/ph/g, 'f')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/z/g, 'j')
    .replace(/ck/g, 'k')
    .replace(/ch/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/sh/g, 's')
    .replace(/g(?=[eiy])/g, 'j')
    .replace(/mb$/, 'm');
  // "h" counts only at the start; elsewhere it marks a breathy sound ("bh", "th") or
  // nothing at all.
  w = w[0] + w.slice(1).replace(/h/g, '');
  // "y" is a consonant only before a vowel at the start ("yoga").
  w = w[0] + w.slice(1).replace(/y/g, 'a');
  w = w.replace(/n(?=[bp])/g, 'm');
  const consonants = w.replace(/^y(?![aeiou])/, '').replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
  return consonants || w.replace(/(.)\1+/g, '$1');
}

function wordInfo(word) {
  const plain = fold(word);
  return { word, plain, sound: sound(plain) };
}

// ---------------------------------------------------------------------------------
// 3. Words that mean the same

// Hindi and Hinglish words for what titles say in English, other names for the
// languages, and everyday names for the store's categories. Keys are folded words.
const MEANINGS = {
  // Hindi and Hinglish
  paisa: 'money', paise: 'money', paisey: 'money', pesa: 'money', pese: 'money', dhan: 'money wealth', daulat: 'money wealth', rupaya: 'money', rupaye: 'money',
  amir: 'rich', amiri: 'rich wealth', dhani: 'rich', garib: 'poor', garibi: 'poor',
  pita: 'dad father', papa: 'dad father', bap: 'dad father', baap: 'dad father', abba: 'dad father', pitaji: 'dad father',
  maa: 'mother', ma: 'mother', mata: 'mother',
  adat: 'habit', adate: 'habit', adaten: 'habit', adatein: 'habit', adte: 'habit', adten: 'habit',
  parmanu: 'atomic', paramanu: 'atomic',
  manovigyan: 'psychology', manovijnan: 'psychology', manovigyn: 'psychology',
  safalta: 'success', kamyabi: 'success', safal: 'success',
  soch: 'think mind', socho: 'think', vichar: 'think thought',
  prem: 'love romance', pyar: 'love romance', pyaar: 'love romance', ishq: 'love romance', mohabat: 'love romance', muhabat: 'love romance', prema: 'love romance',
  kahani: 'story tale', kahaniya: 'story tale', kahaniyan: 'story tale', katha: 'story tale',
  itihas: 'history', itihaas: 'history',
  jivani: 'biography memoir', atmakatha: 'biography memoir', jivan: 'life', jindagi: 'life', zindagi: 'life',
  rahasya: 'mystery secret', rahasy: 'mystery secret', raj: 'secret', raaz: 'secret',
  jasusi: 'mystery thriller detective', jasus: 'detective spy',
  jadu: 'magic fantasy', jaadu: 'magic fantasy',
  dharm: 'mythology', dharma: 'mythology', puran: 'mythology', purana: 'mythology', pauranik: 'mythology', devta: 'god mythology', bhagvan: 'god mythology', bhagwan: 'god mythology',
  samay: 'time', vakt: 'time', waqt: 'time', vaqt: 'time',
  sapna: 'dream', sapne: 'dream', khvab: 'dream', khwab: 'dream',
  dimag: 'mind brain', dimaag: 'mind brain', man: 'mind',
  vyapar: 'business', vyapaar: 'business', dhandha: 'business', nivesh: 'investing investor', share: 'stock trading',
  shakti: 'power', takat: 'power', taakat: 'power',
  dost: 'friend', dosti: 'friend', mitra: 'friend',
  raja: 'king', badshah: 'king', rani: 'queen', rajkumari: 'princess', rajkumar: 'prince',
  yudh: 'war', yuddh: 'war', jang: 'war', jung: 'war',
  shanti: 'peace calm', sukun: 'peace calm', khushi: 'happiness happy', anand: 'happiness happy',
  kavita: 'poetry poem', shayari: 'poetry poem',
  ladki: 'girl', ladka: 'boy', bacche: 'kid children', bachche: 'kid children',
  rat: 'night', raat: 'night', din: 'day', sal: 'year', saal: 'year', suraj: 'sun', chand: 'moon', chaand: 'moon',
  ghar: 'home house', maut: 'death dead', mrityu: 'death dead', hatya: 'murder', katl: 'murder', qatl: 'murder', khun: 'murder blood',
  dil: 'heart', aag: 'fire', pani: 'water', duniya: 'world', sansar: 'world', sach: 'truth', jhut: 'lie liar',
  gita: 'gita bhagavad', bhagvad: 'bhagavad', chanakya: 'chanakya', niti: 'neethi niti',
  // Language names, also as their own scripts read them.
  hindi: 'hindi', bangla: 'bengali', banla: 'bengali', bangali: 'bengali', bengali: 'bengali',
  tamil: 'tamil', tamij: 'tamil', tamizh: 'tamil', thamizh: 'tamil', tamilan: 'tamil',
  malayalam: 'malayalam', malayalan: 'malayalam', malyalam: 'malayalam',
  marathi: 'marathi', gujarati: 'gujarati', gujrati: 'gujarati', telugu: 'telugu', kanada: 'kannada', kannada: 'kannada', kannad: 'kannada',
  panjabi: 'punjabi', punjabi: 'punjabi', urdu: 'urdu', ardu: 'urdu', ardo: 'urdu', odia: 'odia', oria: 'odia', oriya: 'odia',
  english: 'english', angreji: 'english', angrezi: 'english', inglish: 'english',
  // Categories, by other names.
  selfhelp: 'self help', motivation: 'self help', motivational: 'self help', productivity: 'self help', personal: 'self help', growth: 'self help', improvement: 'self help',
  finance: 'money business', investing: 'money business', investment: 'money business', stock: 'money business', trading: 'money business', economic: 'money business', entrepreneur: 'business startup',
  crime: 'thriller mystery', detective: 'thriller mystery', suspense: 'thriller mystery', horror: 'thriller mystery', murder: 'thriller mystery murder',
  romantic: 'romance love', romcom: 'romance love', love: 'romance love',
  comic: 'comic manga', manga: 'comic manga', anime: 'manga comic', graphic: 'comic',
  myth: 'mythology', mythological: 'mythology', historical: 'history',
  autobiography: 'biography memoir', biography: 'biography memoir', memoir: 'biography memoir',
  literature: 'literary fiction', classic: 'literary fiction', literary: 'literary fiction',
  magic: 'fantasy', dragon: 'fantasy', fairy: 'fantasy',
  bundle: 'combo set', pack: 'combo set', boxset: 'box set combo', collection: 'combo set collection', combo: 'combo',
};

// ---------------------------------------------------------------------------------
// 4. Comparing words

// Languages a shopper may ask for. A title names its edition ("Tamil Edition - …");
// books that name none are English.
const LANGUAGES = new Set(['hindi', 'bengali', 'tamil', 'malayalam', 'marathi', 'gujarati', 'telugu', 'kannada', 'punjabi', 'urdu', 'odia', 'english']);

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
const ALIKE = new Set(['td', 'dt', 'kg', 'gk', 'pb', 'bp', 'pf', 'fp', 'bv', 'vb', 'vw', 'wv', 'nm', 'mn', 'ck', 'kc', 'cs', 'sc', 'sz', 'zs', 'jz', 'zj', 'kq', 'qk', 'lr', 'rl']);

function substitution(a, b) {
  if (a === b) return 0;
  if (VOWELS.has(a) && VOWELS.has(b)) return 0.5;
  return ALIKE.has(a + b) ? 0.5 : 1;
}
const gap = (ch) => (VOWELS.has(ch) || ch === 'h' ? 0.5 : 1);

// Edit distance with cheaper steps for look-alike sounds and for vowels, and swapped
// neighbours counted once. Gives up (returns Infinity) once it is past `limit`.
export function distance(a, b, limit = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit + 1) return Infinity;
  const rows = [new Array(b.length + 1).fill(0)];
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = rows[0][j - 1] + gap(b[j - 1]);
  for (let i = 1; i <= a.length; i += 1) {
    const row = (rows[i] = new Array(b.length + 1));
    row[0] = rows[i - 1][0] + gap(a[i - 1]);
    let best = row[0];
    for (let j = 1; j <= b.length; j += 1) {
      let value = Math.min(
        rows[i - 1][j] + gap(a[i - 1]),
        row[j - 1] + gap(b[j - 1]),
        rows[i - 1][j - 1] + substitution(a[i - 1], b[j - 1]),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2][j - 2] + 1);
      row[j] = value;
      if (value < best) best = value;
    }
    if (best > limit) return Infinity;
  }
  return rows[a.length][b.length];
}

function allowedPlain(length) {
  if (length <= 2) return 0;
  if (length <= 4) return 1;
  if (length <= 7) return 1.5;
  if (length <= 11) return 2;
  return 3;
}

function allowedSound(length) {
  if (length <= 2) return 0;
  if (length <= 4) return 0.5;
  if (length <= 6) return 1;
  return 1.5;
}

// How well one query word matches one word of a book, from 0 to 1.
function wordScore(q, b, typing) {
  if (q.plain === b.plain || q.word === b.word) return 1;
  const numeric = /^\d+$/.test(q.plain) || /^\d+$/.test(b.plain);
  if (numeric) return 0;
  let best = 0;
  if (b.word.startsWith(q.word)) {
    if (q.word.length >= 3) best = 0.88;
    else if (typing) best = 0.8;
  }
  const plainLimit = allowedPlain(q.plain.length);
  if (plainLimit > 0) {
    // Typos seldom change the first letter: "harry" is not "mary", "potter" not "mother".
    const a0 = q.plain[0];
    const b0 = b.plain[0];
    const firstCost = a0 === b0 ? 0 : VOWELS.has(a0) && VOWELS.has(b0) ? 0.25 : 0.75;
    const d = distance(q.plain, b.plain, plainLimit) + firstCost;
    if (d <= plainLimit) best = Math.max(best, 0.86 - 0.1 * d);
  }
  if (q.sound.length >= 2 && b.sound.length >= 2) {
    if (q.sound === b.sound) best = Math.max(best, q.sound.length >= 3 ? 0.8 : 0.72);
    else {
      const soundLimit = allowedSound(Math.max(q.sound.length, b.sound.length));
      if (soundLimit > 0) {
        const d = distance(q.sound, b.sound, soundLimit);
        if (d <= soundLimit) best = Math.max(best, 0.74 - 0.12 * d);
      }
      if (typing && q.sound.length >= 3 && b.sound.startsWith(q.sound)) best = Math.max(best, 0.66);
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------
// 5. The index and the ranking

const words = (text) => normalize(text).split(' ').filter(Boolean);
const compact = (text) => normalize(text).replace(/ /g, '');

// Prepares the catalogue once: each book's words, and how common each word is (rare
// words such as an author's name count for more than "love" or "life").
export function buildIndex(books) {
  const entries = books.map((book) => {
    const titleWords = words(book.title).filter((word) => !STOPWORDS.has(word));
    const categoryWords = words(book.category ?? '').filter((word) => !STOPWORDS.has(word));
    return {
      book,
      text: ` ${normalize(book.title)} `,
      compact: compact(book.title),
      title: [...new Set(titleWords)].map(wordInfo),
      category: [...new Set(categoryWords)].map(wordInfo),
      languages: new Set(titleWords.filter((word) => LANGUAGES.has(word) && word !== 'english')),
    };
  });
  const languages = new Set(['english']);
  for (const entry of entries) for (const language of entry.languages) languages.add(language);
  const seen = new Map();
  for (const entry of entries) {
    for (const plain of new Set(entry.title.map((w) => w.plain))) seen.set(plain, (seen.get(plain) ?? 0) + 1);
  }
  return { entries, seen, size: entries.length, languages };
}

function rarity(index, plain) {
  const count = index.seen.get(plain);
  if (!count) return 1;
  return Math.max(0.35, Math.min(1.6, Math.log((index.size + 1) / count) / 2));
}

// The query as words to look for, each with its other meanings.
function parseQuery(query) {
  const all = words(query);
  const kept = all.filter((word) => !STOPWORDS.has(word));
  const list = kept.length > 0 ? kept : all;
  return list.slice(0, 12).map((word, i) => {
    const info = wordInfo(word);
    const meaning = MEANINGS[info.plain] ?? MEANINGS[word];
    if (LANGUAGES.has(meaning)) return { ...info, language: meaning, alternatives: [], typing: false };
    const alternatives = meaning ? meaning.split(' ').filter((m) => m !== info.plain).map(wordInfo) : [];
    return { ...info, alternatives, typing: i === list.length - 1 };
  });
}

function bestIn(q, list) {
  let best = 0;
  for (const b of list) {
    const s = wordScore(q, b, q.typing);
    if (s > best) best = s;
    if (best === 1) break;
  }
  return best;
}

const STRONG = 0.74;
const FLOOR = 0.45;

function scoreEntry(index, entry, terms, phrase, joined) {
  if (terms.length === 0) return 0;
  let total = 0;
  let weights = 0;
  let matched = 0;
  for (const q of terms) {
    if (q.language) {
      // Only the edition counts: "hindi" must not find "Hindu" by spelling.
      const has = q.language === 'english' ? entry.languages.size === 0 : entry.languages.has(q.language);
      const weight = index.languages.has(q.language) ? 1 : 0.3;
      total += has ? weight : 0;
      weights += weight;
      if (has) matched += 1;
      continue;
    }
    let s = bestIn(q, entry.title);
    if (s < 1 && entry.category.length) s = Math.max(s, 0.9 * bestIn(q, entry.category));
    for (const alt of q.alternatives) {
      if (s >= 0.9) break;
      const viaTitle = bestIn({ ...alt, typing: false }, entry.title);
      const viaCategory = 0.9 * bestIn({ ...alt, typing: false }, entry.category);
      s = Math.max(s, 0.9 * Math.max(viaTitle, viaCategory));
    }
    const weight = rarity(index, q.plain);
    total += s * weight;
    weights += weight;
    if (s > 0) matched += 1;
  }
  let score = weights ? total / weights : 0;
  // A few words that all match beat many words that half match.
  if (matched === terms.length && terms.length > 1) score = Math.min(1, score + 0.04);
  // The query appears as it was typed, or with its words run together.
  if (phrase.length >= 3 && entry.text.includes(` ${phrase} `)) score = Math.max(score, entry.text.startsWith(` ${phrase} `) ? 1.02 : 1);
  else if (joined.length >= 5 && entry.compact.includes(joined)) score = Math.max(score, 0.95);
  // Of two equal matches, the one whose title is mostly the query comes first
  // ("Atomic Habits by James Clear" before a combo that includes it).
  if (score >= STRONG) score += 0.04 * Math.min(1, terms.length / Math.max(1, entry.title.length));
  return score;
}

// Ranks the catalogue for a query. Returns every book that is a reasonable match, best
// first, and how good the best one is:
//   'match'   - at least one book matches well,
//   'close'   - nothing matches well, these are the nearest,
//   'none'    - nothing comes near.
// `missing` lists languages asked for that the store has no edition in yet.
export function rankBooks(index, query) {
  const terms = parseQuery(query);
  const missing = [...new Set(terms.filter((t) => t.language && !index.languages.has(t.language)).map((t) => t.language))];
  const phrase = normalize(query);
  const joined = phrase.replace(/ /g, '');
  const scored = [];
  for (const entry of index.entries) {
    const score = scoreEntry(index, entry, terms, phrase, joined);
    if (score >= FLOOR) scored.push({ book: entry.book, score });
  }
  if (scored.length === 0) return { results: [], quality: 'none', missing };
  scored.sort(byScore);
  const top = scored[0].score;
  const cut = Math.max(FLOOR, top * 0.62);
  const results = scored.filter((r) => r.score >= cut);
  return { results, quality: top >= STRONG ? 'match' : 'close', missing };
}

function byScore(a, b) {
  if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
  const stockA = a.book.stock_quantity > 0 ? 1 : 0;
  const stockB = b.book.stock_quantity > 0 ? 1 : 0;
  if (stockA !== stockB) return stockB - stockA;
  if ((b.book.discount_percent ?? 0) !== (a.book.discount_percent ?? 0)) return (b.book.discount_percent ?? 0) - (a.book.discount_percent ?? 0);
  return String(a.book.title).localeCompare(String(b.book.title));
}
