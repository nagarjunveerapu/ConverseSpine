#!/usr/bin/env node
/**
 * Collate-only: generate ~50k labeled buyer phrasings (EN / Hinglish / other)
 * for embedder enrichment + parallel dig stress. Does NOT mutate routing.
 *
 *   node scripts/generate-intent-stress-corpus.mjs
 *   node scripts/generate-intent-stress-corpus.mjs --count 50000 --out corpus/synthetic/intent-stress-50k.jsonl
 *
 * Row shape matches registry-ish fields + stress expectations:
 *   intent_kind (primary), intent_kinds[], topics[], language, complexity, expect{}
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  return args[i + 1] ?? def;
}
const TARGET = Number(flag('count', '50000'));
const OUT = resolve(
  process.cwd(),
  flag('out', 'corpus/synthetic/intent-stress-50k.jsonl'),
);
const SOURCE = 'synthetic_stress_2026_07_29';
const SEED = flag('seed', 'naya-intent-stress-v1');

/** Deterministic PRNG (mulberry32) so re-runs are reproducible. */
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedNum = createHash('sha256').update(SEED).digest().readUInt32LE(0);
const rand = mulberry32(seedNum);
function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}
function chance(p) {
  return rand() < p;
}

/**
 * Closed intent set aligned to embedder-map + action / literacy kinds.
 * topic = AnswerTopic when applicable; null for non-answer acts.
 */
const INTENTS = [
  {
    kind: 'get_price',
    topic: 'price',
    atoms: {
      en: [
        'price',
        'pricing',
        'cost',
        'how much',
        'starting price',
        'per sqft',
        'rate',
        'total cost',
        'all-in cost',
      ],
      'hi-en': ['price kya hai', 'kitna padega', 'rate batao', 'per sqft cost', 'starting price'],
      hi: ['कीमत क्या है', 'कितना पड़ेगा', 'दर बताओ'],
      ta: ['விலை என்ன', 'எவ்வளவு ஆகும்'],
      te: ['ధర ఎంత', 'ఎంత అవుతుంది'],
      kn: ['ಬೆಲೆ ಎಷ್ಟು', 'ಎಷ್ಟಾಗುತ್ತೆ'],
    },
    templates: {
      en: [
        '{a}?',
        'what is the {a}',
        'tell me the {a}',
        'can you share the {a}',
        'need the {a} for this project',
        '{a} for 2 BHK',
        'whats the {a} here',
      ],
      'hi-en': [
        '{a}?',
        '{a} batao',
        'is project ka {a}',
        '{a} kya hai na',
        '2bhk ka {a} kitna',
      ],
      hi: ['{a}?', 'इस प्रोजेक्ट का {a}'],
      ta: ['{a}?', 'இந்த ப்ராஜெக்ட் {a}'],
      te: ['{a}?', 'ఈ ప్రాజెక్ట్ {a}'],
      kn: ['{a}?', 'ಈ ಪ್ರಾಜೆಕ್ಟ್ {a}'],
    },
  },
  {
    kind: 'get_legal_info',
    topic: 'legal',
    atoms: {
      en: [
        'RERA',
        'legal status',
        'title clear',
        'khata',
        'OC',
        'approvals',
        'loan',
        'loan eligibility',
        'LTV',
        'home loan',
        'bank loan',
        'banks',
        'financing',
      ],
      'hi-en': [
        'RERA number',
        'legal clear hai',
        'khata',
        'loan mil jayega',
        'LTV kitna',
        'bank loan',
        'home loan possible',
      ],
      hi: ['रैरा नंबर', 'लोन मिलेगा', 'एलटीवी कितना', 'कानूनी स्थिति'],
      ta: ['RERA எண்', 'கடன் கிடைக்குமா', 'LTV'],
      te: ['RERA నంబర్', 'లోన్ వస్తుందా', 'LTV'],
      kn: ['RERA ಸಂಖ್ಯೆ', 'ಲೋನ್ ಸಿಗುತ್ತಾ', 'LTV'],
    },
    templates: {
      en: [
        '{a}?',
        'what about {a}',
        'is {a} available',
        'tell me about {a}',
        'need {a} details',
        'can I get {a} for this',
      ],
      'hi-en': ['{a}?', '{a} batao', '{a} hai kya', 'ispe {a}?'],
      hi: ['{a}?', '{a} बताओ'],
      ta: ['{a}?'],
      te: ['{a}?'],
      kn: ['{a}?'],
    },
  },
  {
    kind: 'get_availability',
    topic: 'availability',
    atoms: {
      en: [
        'availability',
        'units left',
        'inventory',
        'configs',
        'configurations',
        '2 BHK available',
        'floor plan options',
        'possession',
        'handover',
        'ready to move',
      ],
      'hi-en': ['availability', 'kitne units bache', '2bhk available', 'possession kab', 'handover'],
      hi: ['उपलब्धता', 'यूनिट बचे', 'पजेशन कब'],
      ta: ['கிடைக்குமா', 'possession எப்போ'],
      te: ['అందుబాటు', 'పొసెషన్ ఎప్పుడు'],
      kn: ['ಲಭ್ಯತೆ', 'ಪೊಸೆಷನ್ ಯಾವಾಗ'],
    },
    templates: {
      en: ['{a}?', 'what is the {a}', 'when is {a}', 'share {a}', '{a} for this project'],
      'hi-en': ['{a}?', '{a} batao', '{a} kab hai'],
      hi: ['{a}?'],
      ta: ['{a}?'],
      te: ['{a}?'],
      kn: ['{a}?'],
    },
  },
  {
    kind: 'ask_delivery_timeline',
    topic: 'availability',
    atoms: {
      en: ['possession date', 'delivery timeline', 'handover date', 'completion', 'when ready'],
      'hi-en': ['possession date', 'kab milega', 'handover kab', 'ready kab'],
      hi: ['पजेशन डेट', 'कब मिलेगा'],
      ta: ['possession தேதி'],
      te: ['పొసెషన్ తేదీ'],
      kn: ['ಪೊಸೆಷನ್ ದಿನಾಂಕ'],
    },
    templates: {
      en: ['{a}?', 'what is the {a}', 'when is {a}'],
      'hi-en': ['{a}?', '{a} batao'],
      hi: ['{a}?'],
      ta: ['{a}?'],
      te: ['{a}?'],
      kn: ['{a}?'],
    },
  },
  {
    kind: 'get_brochure',
    topic: 'media',
    atoms: {
      en: ['brochure', 'PDF', 'floor plan', 'layout', 'photos', 'gallery', 'cost sheet', 'price sheet'],
      'hi-en': ['brochure bhejo', 'PDF bhejna', 'floor plan', 'photos dikhao'],
      hi: ['ब्रोशर भेजो', 'फोटो दिखाओ'],
      ta: ['brochure அனுப்பு', 'photos'],
      te: ['brochure పంపు', 'photos'],
      kn: ['brochure ಕಳುಹಿಸಿ', 'photos'],
    },
    templates: {
      en: ['{a}?', 'send the {a}', 'share the {a}', 'can I get the {a}', 'need {a}'],
      'hi-en': ['{a}', '{a} please', '{a} bhejo na'],
      hi: ['{a}'],
      ta: ['{a}'],
      te: ['{a}'],
      kn: ['{a}'],
    },
  },
  {
    kind: 'get_amenities',
    topic: 'amenities',
    atoms: {
      en: ['amenities', 'facilities', 'clubhouse', 'pool', 'gym', 'park', 'kids play area'],
      'hi-en': ['amenities', 'facilities kya hai', 'pool hai', 'gym clubhouse'],
      hi: ['सुविधाएं', 'क्लबहाउस', 'पूल'],
      ta: ['வசதிகள்', 'gym', 'pool'],
      te: ['సౌకర్యాలు', 'gym', 'pool'],
      kn: ['ಸೌಲಭ್ಯಗಳು', 'gym', 'pool'],
    },
    templates: {
      en: ['{a}?', 'what {a} does it have', 'list the {a}', 'tell me about {a}'],
      'hi-en': ['{a}?', '{a} batao', '{a} hai kya'],
      hi: ['{a}?'],
      ta: ['{a}?'],
      te: ['{a}?'],
      kn: ['{a}?'],
    },
  },
  {
    kind: 'get_location_info',
    topic: 'location',
    atoms: {
      en: [
        'location',
        'where is it',
        'connectivity',
        'nearby schools',
        'hospitals nearby',
        'commute',
        'distance to airport',
        'ITPL commute',
        'Whitefield commute',
      ],
      'hi-en': ['location kahan', 'connectivity', 'schools nearby', 'commute Whitefield', 'airport kitna door'],
      hi: ['लोकेशन कहाँ', 'स्कूल पास में', 'कनेक्टिविटी'],
      ta: ['இடம் எங்கே', 'schools nearby'],
      te: ['లొకేషన్ ఎక్కడ', 'schools nearby'],
      kn: ['ಸ್ಥಳ ಎಲ್ಲಿದೆ', 'schools nearby'],
    },
    templates: {
      en: ['{a}?', 'what about {a}', 'tell me {a}', 'need {a} details'],
      'hi-en': ['{a}?', '{a} batao'],
      hi: ['{a}?'],
      ta: ['{a}?'],
      te: ['{a}?'],
      kn: ['{a}?'],
    },
  },
  {
    kind: 'get_project_info',
    topic: 'overview',
    atoms: {
      en: ['overview', 'project details', 'tell me more', 'highlights', 'usps', 'about this project'],
      'hi-en': ['project details', 'overview batao', 'kya special hai', 'highlights'],
      hi: ['प्रोजेक्ट डिटेल्स', 'खास क्या है'],
      ta: ['project details', 'overview'],
      te: ['project details', 'overview'],
      kn: ['project details', 'overview'],
    },
    templates: {
      en: ['{a}?', 'give me {a}', 'share {a}'],
      'hi-en': ['{a}', '{a} please'],
      hi: ['{a}'],
      ta: ['{a}'],
      te: ['{a}'],
      kn: ['{a}'],
    },
  },
  {
    kind: 'ask_about_builder',
    topic: 'overview',
    atoms: {
      en: ['builder reputation', 'who is the builder', 'developer track record', 'builder honesty'],
      'hi-en': ['builder kaun hai', 'builder reputation', 'developer track record'],
      hi: ['बिल्डर कौन है', 'ट्रैक रिकॉर्ड'],
      ta: ['builder யார்'],
      te: ['builder ఎవరు'],
      kn: ['builder ಯಾರು'],
    },
    templates: {
      en: ['{a}?', 'tell me about {a}', 'what about {a}'],
      'hi-en': ['{a}?', '{a} batao'],
      hi: ['{a}?'],
      ta: ['{a}?'],
      te: ['{a}?'],
      kn: ['{a}?'],
    },
  },
  {
    kind: 'compute_emi',
    topic: 'emi',
    atoms: {
      en: ['EMI', 'monthly EMI', 'EMI calculator', 'emi for 80% loan', 'installment'],
      'hi-en': ['EMI kitna', 'monthly EMI', 'EMI calculate karo'],
      hi: ['ईएमआई कितना', 'मासिक किस्त'],
      ta: ['EMI எவ்வளவு'],
      te: ['EMI ఎంత'],
      kn: ['EMI ಎಷ್ಟು'],
    },
    templates: {
      en: ['{a}?', 'what is the {a}', 'calculate {a}', 'need {a}'],
      'hi-en': ['{a}?', '{a} batao'],
      hi: ['{a}?'],
      ta: ['{a}?'],
      te: ['{a}?'],
      kn: ['{a}?'],
    },
  },
  {
    kind: 'get_payment_plan',
    topic: 'price',
    atoms: {
      en: ['payment plan', 'payment schedule', 'construction linked plan', 'CLP', 'down payment'],
      'hi-en': ['payment plan', 'kitna down payment', 'CLP'],
      hi: ['पेमेंट प्लान', 'डाउन पेमेंट'],
      ta: ['payment plan'],
      te: ['payment plan'],
      kn: ['payment plan'],
    },
    templates: {
      en: ['{a}?', 'what is the {a}', 'share {a}'],
      'hi-en': ['{a}?', '{a} batao'],
      hi: ['{a}?'],
      ta: ['{a}?'],
      te: ['{a}?'],
      kn: ['{a}?'],
    },
  },
  {
    kind: 'negotiate_price',
    topic: 'price',
    atoms: {
      en: ['discount', 'any offer', 'best price', 'can you reduce', 'negotiation'],
      'hi-en': ['discount milega', 'offer hai', 'thoda kam karo'],
      hi: ['डिस्काउंट', 'ऑफर है क्या'],
      ta: ['discount உண்டா'],
      te: ['discount ఉందా'],
      kn: ['discount ಇದ್ಯಾ'],
    },
    templates: {
      en: ['{a}?', 'is there {a}', 'any {a} on this'],
      'hi-en': ['{a}?', '{a} kya'],
      hi: ['{a}?'],
      ta: ['{a}?'],
      te: ['{a}?'],
      kn: ['{a}?'],
    },
  },
  {
    kind: 'ask_investment_return',
    topic: 'overview',
    atoms: {
      en: ['appreciation', 'rental yield', 'ROI', 'resale value', 'returns'],
      'hi-en': ['appreciation', 'rental yield', 'ROI kitna', 'resale value'],
      hi: ['एप्रिसिएशन', 'रेंटल यील्ड', 'रिटर्न'],
      ta: ['appreciation', 'ROI'],
      te: ['appreciation', 'ROI'],
      kn: ['appreciation', 'ROI'],
    },
    templates: {
      en: ['{a}?', 'what {a} can I expect', 'tell me about {a}'],
      'hi-en': ['{a}?', '{a} batao'],
      hi: ['{a}?'],
      ta: ['{a}?'],
      te: ['{a}?'],
      kn: ['{a}?'],
    },
  },
  {
    kind: 'book_visit',
    topic: null,
    atoms: {
      en: ['book a visit', 'site visit', 'schedule visit', 'come see', 'weekend visit'],
      'hi-en': ['site visit book', 'visit karna hai', 'weekend aaunga'],
      hi: ['साइट विजिट', 'विजिट बुक करो'],
      ta: ['site visit'],
      te: ['site visit'],
      kn: ['site visit'],
    },
    templates: {
      en: ['{a}', 'I want to {a}', 'can we {a}'],
      'hi-en': ['{a}', '{a} please'],
      hi: ['{a}'],
      ta: ['{a}'],
      te: ['{a}'],
      kn: ['{a}'],
    },
  },
  {
    kind: 'find_projects',
    topic: null,
    atoms: {
      en: ['show more projects', 'other options', 'alternatives', 'shortlist again'],
      'hi-en': ['aur projects dikhao', 'other options', 'shortlist'],
      hi: ['और प्रोजेक्ट दिखाओ'],
      ta: ['வேறு projects'],
      te: ['ఇంకా projects'],
      kn: ['ಇನ್ನಷ್ಟು projects'],
    },
    templates: {
      en: ['{a}', 'please {a}', '{a} under my budget'],
      'hi-en': ['{a}', '{a} na'],
      hi: ['{a}'],
      ta: ['{a}'],
      te: ['{a}'],
      kn: ['{a}'],
    },
  },
  {
    kind: 'compare_projects',
    topic: 'compare',
    atoms: {
      en: ['compare', 'difference', 'vs', 'which is better', 'tradeoff'],
      'hi-en': ['compare karo', 'farq kya hai', 'kaun better'],
      hi: ['तुलना करो', 'कौन बेहतर'],
      ta: ['compare', 'எது better'],
      te: ['compare', 'ఏది better'],
      kn: ['compare', 'ಯಾವುದು better'],
    },
    templates: {
      en: ['{a} these', '{a} the top ones', 'need a {a}'],
      'hi-en': ['{a}', 'dono {a}'],
      hi: ['{a}'],
      ta: ['{a}'],
      te: ['{a}'],
      kn: ['{a}'],
    },
  },
  {
    kind: 'request_callback',
    topic: null,
    atoms: {
      en: ['call me back', 'callback', 'phone me', 'ring me later'],
      'hi-en': ['callback do', 'call karna', 'baad mein phone'],
      hi: ['कॉल बैक', 'फोन करना'],
      ta: ['callback', 'அழைக்கவும்'],
      te: ['callback', 'కాల్ చెయ్యి'],
      kn: ['callback', 'ಕರೆ ಮಾಡಿ'],
    },
    templates: {
      en: ['{a}', 'please {a}', 'can someone {a}'],
      'hi-en': ['{a}', '{a} please'],
      hi: ['{a}'],
      ta: ['{a}'],
      te: ['{a}'],
      kn: ['{a}'],
    },
  },
  {
    kind: 'opt_out',
    topic: null,
    atoms: {
      en: ['stop', 'unsubscribe', 'dont message', 'opt out'],
      'hi-en': ['stop', 'mat bhejo', 'unsubscribe'],
      hi: ['रोको', 'मैसेज मत भेजो'],
      ta: ['stop', 'நிறுத்து'],
      te: ['stop', 'ఆపు'],
      kn: ['stop', 'ನಿಲ್ಲಿಸಿ'],
    },
    templates: {
      en: ['{a}', 'please {a}', '{a} messaging'],
      'hi-en': ['{a}', '{a} karo'],
      hi: ['{a}'],
      ta: ['{a}'],
      te: ['{a}'],
      kn: ['{a}'],
    },
  },
  {
    kind: 'escalate_to_human',
    topic: null,
    atoms: {
      en: ['talk to human', 'agent please', 'real person', 'connect me to advisor'],
      'hi-en': ['human se baat', 'agent chahiye', 'real person'],
      hi: ['इंसान से बात', 'एजेंट चाहिए'],
      ta: ['human பேசு', 'agent'],
      te: ['human తో మాట', 'agent'],
      kn: ['human ಜೊತೆ', 'agent'],
    },
    templates: {
      en: ['{a}', 'I want to {a}', 'please {a}'],
      'hi-en': ['{a}', '{a} please'],
      hi: ['{a}'],
      ta: ['{a}'],
      te: ['{a}'],
      kn: ['{a}'],
    },
  },
  {
    kind: 'definition_bhk',
    topic: null,
    atoms: {
      en: ['what is BHK', 'BHK meaning', 'explain BHK'],
      'hi-en': ['BHK matlab', 'BHK kya hota'],
      hi: ['बीएचके क्या है'],
      ta: ['BHK என்ன'],
      te: ['BHK అంటే'],
      kn: ['BHK ಎಂದರೆ'],
    },
    templates: {
      en: ['{a}', '{a}?'],
      'hi-en': ['{a}?'],
      hi: ['{a}?'],
      ta: ['{a}?'],
      te: ['{a}?'],
      kn: ['{a}?'],
    },
  },
  {
    kind: 'definition_documents',
    topic: null,
    atoms: {
      en: ['what documents needed', 'papers for buying', 'sale deed meaning'],
      'hi-en': ['kaunse documents', 'papers kya chahiye'],
      hi: ['कौन से दस्तावेज'],
      ta: ['என்ன documents'],
      te: ['ఏ documents'],
      kn: ['ಯಾವ documents'],
    },
    templates: {
      en: ['{a}', '{a}?'],
      'hi-en': ['{a}?'],
      hi: ['{a}?'],
      ta: ['{a}?'],
      te: ['{a}?'],
      kn: ['{a}?'],
    },
  },
  {
    kind: 'small_talk',
    topic: null,
    atoms: {
      en: ['thanks', 'ok', 'cool', 'got it', 'nice'],
      'hi-en': ['thanks', 'ok thanks', 'accha', 'theek hai'],
      hi: ['धन्यवाद', 'ठीक है'],
      ta: ['thanks', 'சரி'],
      te: ['thanks', 'సరే'],
      kn: ['thanks', 'ಸರಿ'],
    },
    templates: {
      en: ['{a}'],
      'hi-en': ['{a}'],
      hi: ['{a}'],
      ta: ['{a}'],
      te: ['{a}'],
      kn: ['{a}'],
    },
  },
];

const LANGS = ['en', 'hi-en', 'hi', 'ta', 'te', 'kn'];
const LANG_WEIGHTS = [0.42, 0.35, 0.08, 0.05, 0.05, 0.05];

function pickLang() {
  let x = rand();
  for (let i = 0; i < LANGS.length; i++) {
    x -= LANG_WEIGHTS[i];
    if (x <= 0) return LANGS[i];
  }
  return 'en';
}

const JOINERS = {
  en: [' and ', ', also ', ' plus ', ' as well as ', '; also ', ' — and '],
  'hi-en': [' aur ', ', aur ', ' bhi ', ' plus ', ' & '],
  hi: [' और ', ', ', ' भी '],
  ta: [' மற்றும் ', ', '],
  te: [' మరియు ', ', '],
  kn: [' ಮತ್ತು ', ', '],
};

const PREFIX = {
  en: ['', 'quick q — ', 'one thing: ', 'also, ', 'hey, ', 'for this project, '],
  'hi-en': ['', 'ek baat: ', 'bhai ', 'ispe ', 'project pe '],
  hi: ['', 'एक बात: ', 'इस पर '],
  ta: ['', 'ஒரு கேள்வி: '],
  te: ['', 'ఒక ప్రశ్న: '],
  kn: ['', 'ಒಂದು ಪ್ರಶ್ನೆ: '],
};

const SUFFIX = {
  en: ['', '?', ' please', ' for this one', ' asap', ' if available'],
  'hi-en': ['', '?', ' na', ' please', ' bata dena'],
  hi: ['', '?', ' बताओ'],
  ta: ['', '?'],
  te: ['', '?'],
  kn: ['', '?'],
};

/** Multi-intent pairs/triples that buyers actually stack. */
const MULTI_COMBOS = [
  ['get_price', 'get_legal_info'],
  ['get_price', 'ask_delivery_timeline'],
  ['get_price', 'get_amenities'],
  ['get_price', 'get_brochure'],
  ['get_price', 'compute_emi'],
  ['get_price', 'get_payment_plan'],
  ['get_legal_info', 'ask_delivery_timeline'],
  ['get_legal_info', 'get_brochure'],
  ['get_legal_info', 'get_availability'],
  ['get_amenities', 'get_location_info'],
  ['get_location_info', 'ask_delivery_timeline'],
  ['compute_emi', 'get_payment_plan'],
  ['ask_investment_return', 'get_price'],
  ['get_brochure', 'get_amenities'],
  ['get_availability', 'get_amenities'],
  ['get_price', 'get_legal_info', 'ask_delivery_timeline'],
  ['get_price', 'compute_emi', 'get_payment_plan'],
  ['get_legal_info', 'get_brochure', 'get_amenities'],
  ['get_price', 'get_location_info', 'get_amenities'],
  ['ask_investment_return', 'get_legal_info', 'get_price'],
  ['get_brochure', 'book_visit'],
  ['get_price', 'book_visit'],
  ['get_legal_info', 'book_visit'],
  ['compare_projects', 'get_price'],
  ['find_projects', 'get_price'],
];

function byKind(kind) {
  return INTENTS.find((i) => i.kind === kind);
}

function renderAtom(intent, lang) {
  const atoms = intent.atoms[lang] || intent.atoms.en;
  const templates = intent.templates[lang] || intent.templates.en;
  const a = pick(atoms);
  const t = pick(templates);
  return t.replace(/\{a\}/g, a);
}

function soften(text, lang) {
  const p = pick(PREFIX[lang] || PREFIX.en);
  const s = pick(SUFFIX[lang] || SUFFIX.en);
  let out = `${p}${text}${s}`.replace(/\s+/g, ' ').trim();
  // light typo / chip variants for stress (EN / Hinglish only)
  if ((lang === 'en' || lang === 'hi-en') && chance(0.12)) {
    out = out.replace(/\bthe\b/, 'teh').replace(/\bplease\b/, 'pls').replace(/\bwhat is\b/, 'whats');
  }
  if (chance(0.08) && !/[?]$/.test(out)) out += '?';
  return out;
}

function makeId(phrasing, n) {
  const h = createHash('sha1').update(`${SOURCE}|${n}|${phrasing}`).digest('hex').slice(0, 14);
  return `syn_${h}`;
}

function expectFor(kinds, topics) {
  const answerTopics = topics.filter(Boolean);
  return {
    hold_focus: kinds.every((k) => !['find_projects', 'opt_out'].includes(k)),
    avoid_unknown: !kinds.includes('small_talk'),
    expect_topics: answerTopics,
    expect_primary: kinds[0],
    multi: kinds.length > 1,
  };
}

function row(phrasing, kinds, lang, complexity) {
  const intents = kinds.map(byKind).filter(Boolean);
  const topics = [...new Set(intents.map((i) => i.topic).filter(Boolean))];
  const canonical = phrasing
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    id: makeId(phrasing, randomBytes(4).toString('hex')),
    phrasing,
    canonical,
    intent_kind: kinds[0],
    intent_kinds: kinds,
    topics,
    language: lang,
    complexity,
    is_negative: false,
    hard_negative_for: '',
    source: SOURCE,
    quarantine: false,
    quarantine_reasons: [],
    audit_status: 'synthetic_pending_review',
    routable: true,
    eval_split: chance(0.15) ? 'holdout' : 'train',
    expect: expectFor(kinds, topics),
  };
}

function genSingle() {
  const lang = pickLang();
  const intent = pick(INTENTS);
  const phrasing = soften(renderAtom(intent, lang), lang);
  return row(phrasing, [intent.kind], lang, 'single');
}

function genMulti() {
  const combo = pick(MULTI_COMBOS);
  const lang = pick(['en', 'hi-en', 'hi', 'en', 'hi-en']); // multi mostly EN/Hinglish
  const parts = combo.map((k) => renderAtom(byKind(k), lang));
  const joiner = pick(JOINERS[lang] || JOINERS.en);
  let phrasing;
  if (combo.length === 2) {
    phrasing = soften(parts.join(joiner), lang);
  } else {
    const j2 = pick(JOINERS[lang] || JOINERS.en);
    phrasing = soften(`${parts[0]}${joiner}${parts[1]}${j2}${parts[2]}`, lang);
  }
  return row(phrasing, combo, lang, combo.length === 2 ? 'multi2' : 'multi3');
}

function genComplexNarrative() {
  // Longer multi-clause buyer dumps — hard for embedder + extract.
  const lang = pick(['en', 'hi-en']);
  const combo = pick(MULTI_COMBOS.filter((c) => c.length >= 2));
  const parts = combo.map((k) => renderAtom(byKind(k), lang));
  const phrasing =
    lang === 'en'
      ? soften(
          `for this project I need ${parts.join(', ')} before I decide — also keep it short`,
          lang,
        )
      : soften(
          `is project pe ${parts.join(' aur ')} sab chahiye decide karne se pehle`,
          lang,
        );
  return row(phrasing, combo, lang, 'multi_narrative');
}

mkdirSync(dirname(OUT), { recursive: true });

const seen = new Set();
const rows = [];
const mix = {
  single: Math.floor(TARGET * 0.55),
  multi2: Math.floor(TARGET * 0.28),
  multi3: Math.floor(TARGET * 0.1),
  narrative: 0,
};
mix.narrative = TARGET - mix.single - mix.multi2 - mix.multi3;

let nSingle = 0;
let nMulti2 = 0;
let nMulti3 = 0;
let nNarr = 0;
let guard = 0;
while (rows.length < TARGET && guard < TARGET * 40) {
  guard++;
  let r;
  const needS = nSingle < mix.single;
  const needM2 = nMulti2 < mix.multi2;
  const needM3 = nMulti3 < mix.multi3;
  const needN = nNarr < mix.narrative;
  if (needS && (!needM2 || chance(0.55))) {
    r = genSingle();
  } else if (needM2 && (!needM3 || chance(0.7))) {
    r = genMulti();
    if (r.intent_kinds.length !== 2) continue;
  } else if (needM3) {
    const triples = MULTI_COMBOS.filter((c) => c.length === 3);
    const combo = pick(triples);
    const lang = pick(['en', 'hi-en']);
    const parts = combo.map((k) => renderAtom(byKind(k), lang));
    const j = pick(JOINERS[lang]);
    r = row(soften(parts.join(j), lang), combo, lang, 'multi3');
  } else if (needN) {
    r = genComplexNarrative();
  } else {
    r = genSingle();
  }
  if (seen.has(r.canonical)) continue;
  seen.add(r.canonical);
  rows.push(r);
  if (r.complexity === 'single') nSingle++;
  else if (r.complexity === 'multi2') nMulti2++;
  else if (r.complexity === 'multi3') nMulti3++;
  else nNarr++;
}

writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const byKindCount = {};
const byLang = {};
const byCx = {};
for (const r of rows) {
  byKindCount[r.intent_kind] = (byKindCount[r.intent_kind] || 0) + 1;
  byLang[r.language] = (byLang[r.language] || 0) + 1;
  byCx[r.complexity] = (byCx[r.complexity] || 0) + 1;
}

const meta = {
  generated_at: new Date().toISOString(),
  seed: SEED,
  count: rows.length,
  out: OUT,
  by_complexity: byCx,
  by_language: byLang,
  by_primary_intent: byKindCount,
  multi_combos: MULTI_COMBOS.length,
  intents: INTENTS.map((i) => i.kind),
};
writeFileSync(OUT.replace(/\.jsonl$/, '.meta.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
console.log(`wrote ${rows.length} → ${OUT}`);
