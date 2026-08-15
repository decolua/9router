"use client";

// ElevenLabs panel presets: the v3 tag palette, Enhance vibes and director prompt,
// language roster and starter scripts. Pure data plus one presentational row, kept
// out of TtsExampleCard so the shared card stays about the generic TTS flow.

import { Row } from "./exampleShared";

// ElevenLabs supported languages (ISO 639-1) for Language Override.
// Full roster covered by Multilingual v2 / Eleven v3. en + vi first (primary
// audience), then ordered by reach. language_code is ISO 639-1, so regional
// variants (zh-Hans/zh-Hant, pt-BR/pt-PT) collapse to one base code.
export const ELEVEN_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "zh", name: "中文 (Chinese)" },
  { code: "ja", name: "日本語 (Japanese)" },
  { code: "ko", name: "한국어 (Korean)" },
  { code: "es", name: "Español" },
  { code: "pt", name: "Português" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "ru", name: "Русский" },
  { code: "ar", name: "العربية (Arabic)" },
  { code: "hi", name: "हिन्दी (Hindi)" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "th", name: "ไทย (Thai)" },
  { code: "tl", name: "Tagalog" },
  { code: "nl", name: "Nederlands" },
  { code: "pl", name: "Polski" },
  { code: "tr", name: "Türkçe" },
  { code: "uk", name: "Українська" },
  { code: "cs", name: "Čeština" },
  { code: "he", name: "עברית (Hebrew)" },
  { code: "bn", name: "বাংলা (Bengali)" },
  { code: "ur", name: "اردو (Urdu)" },
  { code: "ro", name: "Română" },
  { code: "sv", name: "Svenska" },
  { code: "el", name: "Ελληνικά (Greek)" },
  { code: "hu", name: "Magyar" },
  { code: "fi", name: "Suomi" },
  { code: "da", name: "Dansk" },
  { code: "no", name: "Norsk" },
  { code: "sk", name: "Slovenčina" },
  { code: "hr", name: "Hrvatski" },
  { code: "ms", name: "Bahasa Melayu" },
  { code: "ta", name: "தமிழ் (Tamil)" },
  { code: "bg", name: "Български" },
];

// ElevenLabs Eleven v3 audio tags — inserted inline to guide expressive delivery.
// Each entry is the exact string inserted into the text (English, ElevenLabs
// format). The chip label is derived by stripping the brackets; the runtime
// i18n layer translates those English labels (and the group headers) per locale.
// Labels are derived once here rather than per render: the palette is ~70
// buttons and re-renders on every keystroke in the textarea.
const tagLabel = (ins) => ins.replace(/[[\]]/g, "");
const withLabels = (group) => ({ ...group, tags: group.tags.map((ins) => ({ ins, label: tagLabel(ins) })) });

export const ELEVEN_V3_TAG_GROUPS = [
  {
    label: "Emotions",
    tags: [
      "[happy]", "[excited]", "[cheerful]", "[energetic]", "[calm]", "[relaxed]",
      "[soft]", "[gentle]", "[sad]", "[emotional]", "[serious]", "[dramatic]",
      "[angry]", "[frustrated]", "[scared]", "[nervous]", "[confident]", "[mysterious]",
      "[sarcastic]", "[playful]", "[seductive]", "[romantic]", "[inspirational]",
      "[motivational]", "[professional]", "[authoritative]", "[cinematic]", "[epic]",
      "[funny]", "[awkward]", "[whispering]", "[crying]", "[shouting]",
    ],
  },
  {
    label: "Delivery",
    tags: [
      "[laughing]", "[chuckles]", "[giggles]", "[sighs]", "[gasping]",
      "[breathing heavily]", "[stuttering]", "[pausing]", "[yelling]", "[murmuring]",
      "[speaking fast]", "[speaking slowly]", "[monotone]", "[storytelling]",
      "[conversational]", "[announcer style]", "[trailer voice]", "[podcast tone]", "[ASMR style]",
    ],
  },
  {
    label: "Sounds",
    tags: [
      "haha", "hmm", "ahh", "oh", "uh", "um", "eh", "tch", "mhm",
      "[gasp]", "[sniff]", "[sob]", "[cough]", "[clears throat]",
      "[lip smack]", "[exhale]", "[inhale]",
    ],
  },
].map(withLabels);

// "Enhance with AI" — a pro voice-director prompt. The model only gets the REAL
// tag palette (the chips above), so it can't invent invalid tags, and a vibe
// preset steers the emotional direction for a more captivating performance.
const ENHANCE_TAG_VOCAB = ELEVEN_V3_TAG_GROUPS
  .map((g) => `${g.label}: ${g.tags.map((t) => t.ins).join(", ")}`)
  .join("\n");

// Vibe presets shown next to the Enhance button (label/hint) + the directive
// line injected into the system prompt (directive).
export const ENHANCE_VIBES = [
  { id: "auto",         label: "Auto",         hint: "Let AI pick the best emotional arc",
    directive: "Choose whatever emotional arc best fits the content." },
  { id: "dramatic",     label: "Dramatic",     hint: "Cinematic, suspenseful, weighty pauses",
    directive: "Go cinematic and suspenseful: weighty pauses before reveals, low intense tone, building tension, a powerful payoff." },
  { id: "energetic",    label: "Energetic",    hint: "Upbeat, fast, hype — great for Shorts",
    directive: "Go high-energy and hook-driven: punchy emphasis, fast excited pacing, big reactions — ideal for short-form social videos." },
  { id: "storytelling", label: "Storytelling", hint: "Warm, immersive narrator",
    directive: "Be a warm, immersive narrator: natural conversational flow, gentle rises and falls, pull the listener into the story." },
  { id: "asmr",         label: "ASMR",         hint: "Soft, intimate, whispered",
    directive: "Keep it soft, slow and intimate: whispered, gentle, calming ASMR delivery." },
  { id: "funny",        label: "Funny",        hint: "Playful, comedic timing",
    directive: "Be playful and comedic: light tone, well-timed laughs and beats, a little exaggeration." },
];

export const vibeById = (id) => ENHANCE_VIBES.find((v) => v.id === id) || ENHANCE_VIBES[0];

// Per-clip icon buttons in the history list. Pure data, so the shared button
// styling isn't written out once per action; `runClipAction` dispatches on key.

export const SettingRow = ({ label, hint, children }) => (
  <Row label={label}>
    <div className="flex flex-col gap-1.5">
      {children}
      <span className="text-[11px] text-text-muted">{hint}</span>
    </div>
  </Row>
);

export const buildEnhancePrompt = (vibeId) => `You are a world-class voice-acting director for ElevenLabs Eleven v3 text-to-speech.
Direct a captivating, emotionally dynamic performance of the user's text by inserting inline audio tags and natural vocal sounds between the existing words.

TECHNIQUES (apply tastefully, not on every line):
- Hook first: set an attention-grabbing emotion on the opening line.
- Contrast & dynamics: never stay flat — let emotion rise, fall and shift.
- Strategic pauses right before key words or reveals for impact.
- Vary pacing: speed up for excitement, slow down to add weight.
- Land the ending with impact.

VOCAL SOUNDS — this is what makes a read feel human, so actually use them:
- Bracketed body sounds ([gasp], [sighs], [chuckles], [clears throat], [inhale]…) sit between words and are performed, not spoken.
- Bare sounds (haha, hmm, ahh, oh, uh, eh, mhm) are SPOKEN aloud, so they land as real speech. Put them where a person would genuinely react: before a surprise, mid-realisation, after a joke, on a reluctant admission.
- Anything longer than one sentence should carry at least two vocal sounds. Match them to the direction below — laughs for playful, breaths and sighs for dramatic or intimate, hesitation sounds for conversational.

DIRECTION: ${vibeById(vibeId).directive}

ALLOWED TAGS — use ONLY these, copied exactly as written:
${ENHANCE_TAG_VOCAB}

HARD RULES:
- Keep every original word and the original language EXACTLY — never translate, reword, reorder or delete the user's words.
- The only things you may INSERT are entries from the allowed list: bracketed tags, and the bare vocal sounds. Adding a bare sound is expected and does not count as changing the text.
- Roughly one bracketed emotion or delivery tag per 1–2 sentences, plus vocal sounds wherever they land naturally. Placement quality over quantity.
- No quotes around the text, no explanations, no markdown.

EXAMPLE
Input: Wait... you're telling me we actually won?
Output: [calm] Wait... [gasp] [pausing] [excited] you're telling me we actually won? haha [laughing]

Return ONLY the resulting tagged text.`;

// Model-name scoring for the Enhance rewrite. Regexes are module constants so a
// sort over a few hundred model ids doesn't rebuild them thousands of times.
// \b word-boundaries avoid "mini" matching the provider word "geMINI".
const CHEAP_TIER_RE = /\b(flash|mini|haiku|lite|nano|small|turbo|8b|9b)\b/;
const COSTLY_TIER_RE = /\b(pro|opus|ultra|max|405b|70b)\b/;
const UNSTABLE_RE = /(preview|exp|beta)/;

// Pick the cheapest stable model for this lightweight rewrite, by name.
export const scoreModel = (id) => {
  const m = (id.includes("/") ? id.slice(id.indexOf("/") + 1) : id).toLowerCase();
  let s = 0;
  if (CHEAP_TIER_RE.test(m)) s += 3;   // cheap/fast tier
  if (COSTLY_TIER_RE.test(m)) s -= 3;  // expensive/gated
  if (UNSTABLE_RE.test(m)) s -= 1;     // unstable/quota-limited
  return s;
};

// "Get started with" — one-tap starter scripts (pre-tagged Eleven v3 demos).
// Clicking fills the editor and sets a matching vibe + stability. The spoken
// text stays English (it's voice demo content); only the button labels localize.
export const ELEVEN_STARTERS = [
  {
    id: "ai-tech", label: "Examine AI tech", icon: "neurology",
    vibe: "storytelling", stability: 0.5,
    text: "[professional] Artificial intelligence is moving faster than ever. [pausing] From voices that sound truly human, to models that reason in real time — [confident] the line between machine and human is blurring. [pausing] So the real question is: are we ready for what comes next?",
  },
  {
    id: "your-voice", label: "Discover your voice", icon: "mic",
    vibe: "storytelling", stability: 0.5,
    text: "[calm] Close your eyes for a second. [pausing] Everyone has a voice — [emotional] a sound that is entirely their own. [confident] Today, you get to discover yours. [excited] So take a breath… and let us begin.",
  },
  {
    id: "laugh", label: "Laugh uncontrollably", icon: "sentiment_very_satisfied",
    vibe: "funny", stability: 0,
    text: "[laughing] Oh my gosh, did you actually just do that? [giggles] I can't— [laughing] I can't breathe! [chuckles] Stop, stop, you're killing me! haha [laughing] this is the funniest thing I have ever seen!",
  },
  {
    id: "dialogue", label: "Construct a dialogue", icon: "forum",
    vibe: "energetic", stability: 0.5,
    text: "[conversational] — Hey, did you hear the news? [excited] We got the job! [happy] — Wait, seriously? [excited] That is incredible! [laughing] — I know, right? [confident] Let us go celebrate.",
  },
  {
    id: "memory", label: "Recall a haunting memory", icon: "menu_book",
    vibe: "dramatic", stability: 0,
    text: "[whispering] I still remember that night. [pausing] [sighs] The hallway was silent… [mysterious] too silent. [nervous] And then I heard it — [dramatic] a voice that was not mine, whispering my name.",
  },
  {
    id: "overlap", label: "Overlap speech", icon: "graphic_eq",
    vibe: "energetic", stability: 0.5,
    text: "[speaking fast] No no no, listen— [excited] — but that is exactly what I— [laughing] would you let me finish? [chuckles] — okay, okay, go ahead, [conversational] I am listening.",
  },
];
