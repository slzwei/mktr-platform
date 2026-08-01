/**
 * Quiz starter templates for the Studio Quiz panel ("Load starter" / "Start blank").
 *
 * Hoisted verbatim from the classic editor's QuizPanel when that surface was
 * deleted (P2-5) — the Studio panel had been importing these two constants from
 * the otherwise-dead file, which was the only thing keeping it compiled.
 *
 * The scorer (src/lib/quizScoring.js + backend/quizScoringService.js) reads this
 * shape. Each option maps to exactly one result profile (scores = { [id]: 1 }).
 * Canonical schema + validated content: docs/quiz-protection-personality.md.
 */

// The validated "Protection Personality" quiz (v2). "Load starter" drops this in
// so admins begin from the tested quiz and tweak copy, rather than building blind.
export const STARTER_QUIZ = {
  enabled: true,
  quizId: "protection-personality",
  version: 2,
  intro: {
    headline: "What's your money personality?",
    subhead: "A 60-second quiz. Find your type — and your blind spots.",
    ctaLabel: "Start the quiz",
  },
  scoring: {
    method: "profile-sum",
    tiebreak: "prepared-first",
    profileOrder: ["the-rock", "the-strategist", "the-dreamer", "the-free-spirit"],
    readiness: {
      enabled: true,
      label: "Your Protection Readiness",
      rankFactor: { "the-rock": 1.0, "the-strategist": 0.66, "the-dreamer": 0.33, "the-free-spirit": 0.0 },
    },
    leadScore: {
      enabled: true,
      tagPoints: {
        exposed: 3, uncertain: 2, covered: 1, confident: 0,
        "family-dependents": 3, couple: 2, single: 1, "single-free": 1,
        "life-income": 2, "savings-retirement": 2, "nurture-warm": 1, "nurture-cold": 0,
      },
      bands: [
        { gte: 6, label: "Hot", badge: "🔥" },
        { gte: 3, label: "Warm", badge: "🌤️" },
        { label: "Cool", badge: "❄️" },
      ],
    },
  },
  reveal: {
    alwaysShowGap: true,
    rarityEnabled: true,
    valueExchange: "Where should we send your full Protection Breakdown?",
    ctaSubtext: "Plus a free 15-min gap review with a licensed adviser.",
    tagAFriend: "Tag a friend who's a total Free Spirit 😎",
    disclaimer: "This quiz is for general information only and is not financial advice. By submitting, you agree to be contacted by a licensed financial representative.",
  },
  steps: [
    { id: "step1", questions: [{ id: "q1_weekend", prompt: "Pick your ideal weekend", type: "single", weight: 1, options: [
      { id: "cosy", label: "Cosy, planned, in bed by 11 🛌", scores: { "the-rock": 1 } },
      { id: "mix", label: "A bit of plan, a bit of spontaneous", scores: { "the-strategist": 1 } },
      { id: "adventure", label: "Last-minute yes to everything 🙌", scores: { "the-dreamer": 1 } },
      { id: "night", label: "Wherever the night takes me 🎉", scores: { "the-free-spirit": 1 } },
    ] }] },
    { id: "step2", questions: [{ id: "q2_payday", prompt: "Payday hits. First move?", type: "single", weight: 2, options: [
      { id: "save", label: "Straight to savings & investments 💰", scores: { "the-rock": 1 } },
      { id: "split", label: "Split — some saved, some for me", scores: { "the-strategist": 1 } },
      { id: "bills", label: "Pay the bills, pray for leftover", scores: { "the-dreamer": 1 } },
      { id: "treat", label: "Treat myself first — life's short! 🧋", scores: { "the-free-spirit": 1 } },
    ] }] },
    { id: "step3", questions: [{ id: "q3_circle", prompt: "Who's in your circle right now?", type: "single", weight: 2, options: [
      { id: "family", label: "Family who count on me (kids / parents)", scores: { "the-rock": 1 }, tag: "family-dependents" },
      { id: "partner", label: "Me and my other half", scores: { "the-strategist": 1 }, tag: "couple" },
      { id: "solo", label: "Just me — building my future", scores: { "the-dreamer": 1 }, tag: "single" },
      { id: "free", label: "Just me — no strings, living free", scores: { "the-free-spirit": 1 }, tag: "single-free" },
    ] }] },
    { id: "step4", questions: [{ id: "q4_worry", prompt: "The 'what if' that nags you most?", type: "single", weight: 1, options: [
      { id: "family_ok", label: "\"Would my family be okay without me?\"", scores: { "the-rock": 1 }, tag: "life-income" },
      { id: "saving", label: "\"Am I saving enough for the future?\"", scores: { "the-strategist": 1 }, tag: "savings-retirement" },
      { id: "eventually", label: "\"I'll sort my finances out… eventually\"", scores: { "the-dreamer": 1 }, tag: "nurture-warm" },
      { id: "avoid", label: "\"Honestly, I try not to think about it\"", scores: { "the-free-spirit": 1 }, tag: "nurture-cold" },
    ] }] },
    { id: "step5", questions: [{ id: "q5_protected", prompt: "How protected do you feel right now?", type: "single", weight: 3, options: [
      { id: "solid", label: "Rock-solid — life, health, the works", scores: { "the-rock": 1 }, tag: "confident" },
      { id: "basics", label: "Pretty covered — got the basics", scores: { "the-strategist": 1 }, tag: "covered" },
      { id: "patchy", label: "A bit patchy — not sure what I have", scores: { "the-dreamer": 1 }, tag: "uncertain" },
      { id: "exposed", label: "Honestly? Exposed", scores: { "the-free-spirit": 1 }, tag: "exposed" },
    ] }] },
    { id: "step6", questions: [{ id: "q6_bill", prompt: "A surprise $5,000 bill lands tomorrow. You…", type: "single", weight: 3, options: [
      { id: "fund", label: "Tap my emergency fund — no stress", scores: { "the-rock": 1 } },
      { id: "sting", label: "Manage, but it'd sting", scores: { "the-strategist": 1 } },
      { id: "credit", label: "Scramble a bit / put it on credit", scores: { "the-dreamer": 1 } },
      { id: "later", label: "Cross that bridge when I get there 🤷", scores: { "the-free-spirit": 1 } },
    ] }] },
  ],
  resultProfiles: [
    { id: "the-rock", title: "The Rock", subtitle: "The Guardian", description: "You think ahead and make sure the people you love are covered.", tagline: "Rain or shine, my people are covered. 🛡️", themeColor: "#0F9D58", ctaLabel: "Get my free protection check", agentAngle: "optimise / legacy / wealth transfer" },
    { id: "the-strategist", title: "The Strategist", subtitle: "The Planner", description: "Solid foundations, playing the long game. A few smart moves and you're sorted.", tagline: "Agak-agak also must steady. ♟️", themeColor: "#1A73E8", ctaLabel: "See where I can level up", agentAngle: "savings / retirement top-up" },
    { id: "the-dreamer", title: "The Big Dreamer", subtitle: "The Go-Getter", description: "Chasing big goals. Protection is on the list — just not at the top yet.", tagline: "Chiong first, sort the rest later lah! 🚀", themeColor: "#F4B400", ctaLabel: "Show me my blind spots", agentAngle: "starter health + CI, then savings" },
    { id: "the-free-spirit", title: "The Free Spirit", subtitle: "The Live-for-Now", description: "You live for today. Spontaneous and fun — but a curveball could catch you off guard.", tagline: "YOLO! Future me can deal with it. 😎", themeColor: "#DB4437", ctaLabel: "Find my biggest gap", agentAngle: "affordable starter protection" },
  ],
};

export const BLANK_QUIZ = {
  enabled: true,
  quizId: "",
  version: 1,
  intro: { headline: "", subhead: "", ctaLabel: "Start" },
  scoring: { method: "profile-sum", tiebreak: "prepared-first", profileOrder: [], readiness: { enabled: false, rankFactor: {} }, leadScore: { enabled: false, tagPoints: {}, bands: [] } },
  steps: [],
  resultProfiles: [],
};
