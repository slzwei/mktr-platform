export const GUIDED_REVIEW_SECTION_LIBRARY = [
  { id: 'hero', label: 'Hero', description: 'Offer, headline and primary action' },
  { id: 'audience', label: 'Audience', description: 'Who the review is designed for' },
  { id: 'problem', label: 'Why it matters', description: 'Context, urgency and pain points' },
  { id: 'review', label: 'Review details', description: 'What happens in the session' },
  { id: 'rewards', label: 'Rewards', description: 'Draw and attendance incentives' },
  { id: 'questions', label: 'Questions', description: 'Intent and qualification check' },
  { id: 'booking', label: 'Booking', description: 'Next step and appointment promise' },
  { id: 'trust', label: 'Trust & legal', description: 'Partner and regulatory disclosure' },
  { id: 'success', label: 'Success screen', description: 'Confirmation after submission' },
];

const DEFAULT_SECTIONS = GUIDED_REVIEW_SECTION_LIBRARY.map((section) => ({
  id: section.id,
  type: section.id,
  visible: true,
}));

const FINANCIAL_READINESS_THEME = {
  accent: '#b85535',
  ink: '#1f2d3d',
  paper: '#f7f1e8',
  sage: '#6f8170',
  headingStyle: 'editorial',
};

const PRENATAL_MONEY_THEME = {
  accent: '#c05f6f',
  ink: '#3b3038',
  paper: '#fff3f0',
  sage: '#7e8f83',
  headingStyle: 'editorial',
};

const GENERAL_WELLNESS_THEME = {
  accent: '#16736f',
  ink: '#18343c',
  paper: '#edf7f3',
  sage: '#63877d',
  headingStyle: 'modern',
};

export const GUIDED_REVIEW_REWARD_CONDITIONS = [
  { id: 'submission', label: 'Submit the qualification check' },
  { id: 'attendance', label: 'Attend the review' },
  { id: 'completed_booking', label: 'Book and complete the review' },
];

export function rewardConditionLabel(reward) {
  const option = GUIDED_REVIEW_REWARD_CONDITIONS.find((item) => item.id === reward?.conditionKey);
  return option?.label || reward?.condition || '';
}

export function reorderGuidedReviewSections(sections, activeId, overId) {
  const activeIndex = sections.findIndex((section) => section.id === activeId);
  const overIndex = sections.findIndex((section) => section.id === overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return sections;
  const reordered = [...sections];
  const [moved] = reordered.splice(activeIndex, 1);
  reordered.splice(overIndex, 0, moved);
  return reordered;
}

function createFinancialReadinessTemplate(campaignName = 'Financial Readiness Review') {
  return {
    version: 2,
    templateId: 'financial_readiness',
    theme: { ...FINANCIAL_READINESS_THEME },
    sections: DEFAULT_SECTIONS.map((section) => ({ ...section })),
    customSections: {},
    hero: {
      eyebrow: `${campaignName} · Complimentary session`,
      headline: 'Know where your money stands.',
      supportingHeadline: 'Then decide what is worth fixing.',
      body:
        'Take a short financial readiness check, then sit down with a licensed adviser for a practical, no-pressure review of the years ahead.',
      ctaLabel: 'Take the 3-minute check',
      closingLabel: 'Limited review slots available',
      visualLabel: 'Your financial picture, made clear',
    },
    audience: {
      eyebrow: 'Designed for you',
      title: 'A focused review for working adults.',
      body: 'Clear enough to be useful, practical enough to act on, and tailored to the stage of life you are in now.',
      chips: ['Singapore Citizens & PRs', 'Ages 30–50', 'No purchase required'],
    },
    problem: {
      eyebrow: 'Why now',
      title: 'Small gaps become expensive when they are left alone.',
      body:
        'Most people have pieces of a plan—CPF, savings, insurance—but have never seen how those pieces work together.',
      cards: [
        { title: 'Retirement income', body: 'See what CPF LIFE and your own savings may actually provide each month.' },
        { title: 'Income protection', body: 'Understand what happens if illness or injury interrupts your pay.' },
        { title: 'Long-term care', body: 'Compare the government base with the likely cost of care later in life.' },
      ],
    },
    review: {
      eyebrow: 'The session',
      title: 'What happens in the review.',
      body:
        'A licensed adviser looks at your current position, answers your questions and gives you a clear list of what deserves attention.',
      duration: '45 minutes',
      mode: 'Online or in person',
      noObligation: 'No products are sold during the review. What you do afterwards is entirely up to you.',
      outcomes: [
        { title: 'Map what you already have', body: 'CPF, savings, protection and existing commitments.' },
        { title: 'Find the meaningful gaps', body: 'Focus on the few issues that could materially affect you.' },
        { title: 'Leave with next steps', body: 'A short, prioritised list—not another pile of financial jargon.' },
      ],
    },
    rewards: {
      eyebrow: 'What you receive',
      title: 'One check. Two ways to benefit.',
      grand: {
        label: 'Grand prize draw',
        title: 'Your pick of four prizes',
        value: 'Worth up to S$570',
        body: 'Complete the readiness check to enter the draw. No purchase required.',
        conditionKey: 'submission',
        condition: 'Submit the qualification check',
        quantity: 1,
        fulfilmentDays: 30,
      },
      attendance: {
        label: 'Attendance thank-you',
        title: 'S$10 Grab voucher',
        value: 'Limited quantity',
        body: 'Complete the review and receive a voucher while stocks last.',
        conditionKey: 'attendance',
        condition: 'Attend the review',
        quantity: 100,
        fulfilmentDays: 7,
        fulfilment: 'Delivered within 7 days',
      },
    },
    questions: {
      eyebrow: 'First step',
      title: 'It starts with three useful questions.',
      body: 'Your answers help the adviser understand what matters before contacting you.',
      ctaLabel: 'Start the check',
      items: [
        {
          id: 'retirement-income',
          prompt: 'What monthly income would you want in retirement?',
          options: ['Under S$2,000', 'S$2,000–S$4,000', 'S$4,000–S$6,000', 'More than S$6,000', 'Not sure'],
        },
        {
          id: 'income-protection',
          prompt: 'If illness or injury stopped your pay, how prepared would you feel?',
          options: ['Very prepared', 'Somewhat prepared', 'Not prepared', 'Not sure'],
        },
        {
          id: 'long-term-care',
          prompt: 'Have you thought about how you would cover long-term care costs?',
          options: ['Yes, I have a plan', 'I have thought about it', 'Not really', 'Not sure'],
        },
      ],
    },
    booking: {
      eyebrow: 'After you submit',
      title: 'We arrange the review around you.',
      body: 'A coordinator will contact you to confirm a suitable time and whether you prefer an online or in-person session.',
      ctaLabel: 'Request my review',
      note: 'Submitting does not create an advisory relationship or require you to buy anything.',
    },
    trust: {
      eyebrow: 'Clear from the start',
      title: 'Who is involved.',
      operator: 'Redeem, a service of MKTR PTE. LTD.',
      operatorUen: '202507548M',
      partner: 'Licensed financial advisory partner',
      disclosure:
        'Redeem operates the campaign and may be remunerated for introductions. Financial advice, if any, is provided only by the named licensed financial advisory firm and its appointed representative.',
      privacyLabel: 'Campaign privacy policy',
      termsLabel: 'Campaign terms & conditions',
    },
    success: {
      eyebrow: 'Review requested',
      title: 'Your reward is reserved.',
      body: 'We have received your answers securely. A coordinator will contact you to arrange the review.',
      statusLabel: 'Attendance reward reserved',
      nextStep: 'Complete the review to unlock your voucher. Your confirmation and sharing link have been sent by email.',
      shareLabel: 'Share with a friend',
    },
  };
}

const PRENATAL_OVERRIDES = {
  templateId: 'prenatal_money_review',
  theme: { ...PRENATAL_MONEY_THEME },
  hero: {
    headline: 'Make room for baby—and the life around them.',
    supportingHeadline: 'Turn the next twelve months into a plan you can both see.',
    body: 'Take a short family-readiness check, then review cash flow, protection and the milestones that arrive before and after baby.',
    ctaLabel: 'Take the family check',
    visualLabel: 'Your growing family plan',
  },
  audience: {
    title: 'For parents preparing for a new arrival.',
    body: 'A calm, practical review for couples who want to understand the financial changes ahead without being buried in jargon.',
    chips: ['Expecting or new parents', 'Singapore Citizens & PRs', 'No purchase required'],
  },
  problem: {
    title: 'A baby changes more than the shopping list.',
    body: 'Leave, childcare, healthcare and protection decisions can arrive together. Seeing the whole picture makes trade-offs easier.',
    cards: [
      { title: 'First-year cash flow', body: 'Map leave, medical costs, essentials and the buffer you may need.' },
      { title: 'Available support', body: 'Understand relevant grants, accounts and benefits to investigate.' },
      { title: 'Family protection', body: 'Review what happens if either parent cannot work or care for the family.' },
    ],
  },
  review: {
    title: 'A practical family money review.',
    body: 'A licensed adviser helps you organise the decisions ahead and identify which gaps deserve attention first.',
    outcomes: [
      { title: 'Build the first-year view', body: 'Put expected costs, income changes and savings in one place.' },
      { title: 'Check family safeguards', body: 'Review healthcare, income protection and emergency arrangements.' },
      { title: 'Prioritise the next steps', body: 'Leave with a short plan you can discuss and act on together.' },
    ],
  },
  rewards: {
    title: 'A useful check, with a little help for the nursery.',
    grand: {
      label: 'Family essentials draw',
      title: 'Baby essentials voucher',
      value: 'Value set by campaign operator',
      body: 'Complete the family check to enter the draw. No purchase required.',
    },
    attendance: {
      label: 'Review thank-you',
      title: 'Family essentials e-voucher',
      value: 'Limited quantity',
      body: 'Complete the review and receive an e-voucher while stocks last.',
    },
  },
  questions: {
    title: 'Three questions before the conversation.',
    body: 'Your answers help the adviser prepare for your family stage and priorities.',
    ctaLabel: 'Start the family check',
    items: [
      { id: 'family-stage', prompt: 'Which stage best describes your family now?', options: ['Planning for a baby', 'Expecting in the next 6 months', 'Expecting in 6–12 months', 'Baby is already here'] },
      { id: 'planning-confidence', prompt: 'How confident do you feel about the first year financially?', options: ['Very confident', 'Somewhat confident', 'Not confident yet', 'Not sure where to start'] },
      { id: 'family-priority', prompt: 'What would be most useful to review first?', options: ['Cash flow and savings', 'Healthcare costs', 'Income protection', 'Education planning', 'Everything together'] },
    ],
  },
  booking: {
    title: 'Choose a time that works for both of you.',
    body: 'A coordinator will contact you to arrange an online or in-person family review.',
    ctaLabel: 'Request our family review',
  },
  success: {
    title: 'Your family review is requested.',
    body: 'We have received your answers securely. A coordinator will contact you to arrange a suitable time.',
  },
};

const GENERAL_WELLNESS_OVERRIDES = {
  templateId: 'general_wellness',
  theme: { ...GENERAL_WELLNESS_THEME },
  hero: {
    headline: 'Give your finances a proper check-in.',
    supportingHeadline: 'See what is working, what is exposed, and what comes next.',
    body: 'Answer a few practical questions, then speak with a licensed adviser about the goals and gaps that matter to you now.',
    ctaLabel: 'Start my money check-in',
    visualLabel: 'Your financial wellness view',
  },
  audience: {
    title: 'Useful at almost any adult life stage.',
    body: 'For people who have savings, commitments or plans—but want a clearer sense of how the pieces fit together.',
    chips: ['Ages 21–67', 'Singapore Citizens & PRs', 'No purchase required'],
  },
  problem: {
    title: 'Financial wellness is more than a savings balance.',
    body: 'Cash flow, protection and future goals affect one another. A structured review helps surface the most useful next move.',
    cards: [
      { title: 'Everyday resilience', body: 'Check whether your cash buffer and commitments can absorb a surprise.' },
      { title: 'Protection gaps', body: 'Understand where illness, injury or caregiving could disrupt your plans.' },
      { title: 'Future direction', body: 'Connect today’s choices to property, family, retirement or other goals.' },
    ],
  },
  review: {
    duration: '60 minutes',
    title: 'A whole-picture financial check-in.',
    body: 'A licensed adviser reviews your priorities, existing arrangements and the decisions you have been putting off.',
    outcomes: [
      { title: 'Clarify the current picture', body: 'Organise your goals, commitments and existing safeguards.' },
      { title: 'Identify the pressure points', body: 'Focus on gaps that could have the greatest impact.' },
      { title: 'Choose a realistic next step', body: 'Leave with a practical priority list at your pace.' },
    ],
  },
  rewards: {
    title: 'Complete the check-in and unlock campaign rewards.',
    grand: {
      label: 'Campaign draw',
      title: 'Lifestyle prize draw',
      value: 'Prize value set by campaign operator',
      body: 'Submit the financial wellness check to enter. No purchase required.',
    },
    attendance: {
      label: 'Attendance thank-you',
      title: 'Digital lifestyle voucher',
      value: 'Limited quantity',
      body: 'Complete the review and receive a voucher while stocks last.',
    },
  },
  questions: {
    title: 'Start with what matters to you.',
    body: 'These answers make the follow-up more relevant and less generic.',
    ctaLabel: 'Start my check-in',
    items: [
      { id: 'financial-priority', prompt: 'What is your biggest financial priority right now?', options: ['Build savings', 'Protect my income', 'Plan for a home', 'Plan for family', 'Prepare for retirement', 'Not sure'] },
      { id: 'emergency-buffer', prompt: 'How long could your savings cover essential expenses?', options: ['Less than 1 month', '1–3 months', '3–6 months', 'More than 6 months', 'Not sure'] },
      { id: 'review-timing', prompt: 'When would you like to improve your current plan?', options: ['As soon as possible', 'Within 3 months', 'Later this year', 'Just exploring'] },
    ],
  },
  booking: { title: 'Turn your answers into a useful conversation.', ctaLabel: 'Request my check-in' },
  success: { title: 'Your financial check-in is requested.' },
};

export const GUIDED_REVIEW_TEMPLATES = [
  {
    id: 'financial_readiness',
    label: 'Financial Readiness',
    description: 'Retirement, protection and long-term care',
    paletteLabel: 'Terracotta · navy · warm cream',
    theme: FINANCIAL_READINESS_THEME,
  },
  {
    id: 'prenatal_money_review',
    label: 'Prenatal Money Review',
    description: 'Cash flow and protection for growing families',
    paletteLabel: 'Soft rose · plum · blush',
    theme: PRENATAL_MONEY_THEME,
  },
  {
    id: 'general_wellness',
    label: 'General Financial Wellness',
    description: 'A broad whole-picture financial check-in',
    paletteLabel: 'Calm teal · deep blue · mint',
    theme: GENERAL_WELLNESS_THEME,
  },
];

export function createGuidedReviewTemplate(templateId = 'financial_readiness', campaignName) {
  const base = createFinancialReadinessTemplate(campaignName);
  if (templateId === 'prenatal_money_review') return mergeRecord(base, PRENATAL_OVERRIDES);
  if (templateId === 'general_wellness') return mergeRecord(base, GENERAL_WELLNESS_OVERRIDES);
  return base;
}

export function createGuidedReviewDefaults(campaignName = 'Financial Readiness Review') {
  return createGuidedReviewTemplate('financial_readiness', campaignName);
}

export function applyGuidedReviewAiDraft(current, aiDraft, campaignName) {
  const templateId = GUIDED_REVIEW_TEMPLATES.some((template) => template.id === aiDraft?.templateId)
    ? aiDraft.templateId
    : current?.templateId || 'financial_readiness';
  const base = createGuidedReviewTemplate(templateId, campaignName);
  const generated = mergeRecord(base, aiDraft?.content || {});
  const preserveRewardOperations = (key) => {
    const generatedReward = generated.rewards[key];
    const currentReward = current?.rewards?.[key] || {};
    const operationalKeys = ['title', 'value', 'conditionKey', 'condition', 'quantity', 'fulfilmentDays', 'fulfilment'];
    return operationalKeys.reduce((reward, field) => (
      currentReward[field] === undefined ? reward : { ...reward, [field]: currentReward[field] }
    ), generatedReward);
  };
  return {
    ...generated,
    templateId,
    sections: current?.sections || generated.sections,
    customSections: current?.customSections || {},
    trust: current?.trust || generated.trust,
    rewards: {
      ...generated.rewards,
      grand: preserveRewardOperations('grand'),
      attendance: preserveRewardOperations('attendance'),
    },
    questions: {
      ...generated.questions,
      items: (generated.questions.items || []).map((question, index) => ({
        ...question,
        id: question.id || slug(question.prompt, `ai-question-${index + 1}`),
      })),
    },
  };
}

function mergeRecord(base, stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return base;
  const next = { ...base, ...stored };
  for (const [key, value] of Object.entries(base)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = mergeRecord(value, stored[key]);
    }
  }
  return next;
}

export function normalizeGuidedReview(stored, campaignName) {
  const defaults = createGuidedReviewTemplate(stored?.templateId || 'financial_readiness', campaignName);
  const merged = mergeRecord(defaults, stored);
  merged.sections = Array.isArray(stored?.sections) && stored.sections.length
    ? stored.sections
    : defaults.sections;
  return merged;
}

function slug(value, fallback) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return normalized || fallback;
}

export function guidedReviewToQuiz(guidedReview) {
  const questionsSection = guidedReview?.sections?.find((section) => section.type === 'questions');
  if (questionsSection?.visible === false) return null;
  const questions = Array.isArray(guidedReview?.questions?.items)
    ? guidedReview.questions.items.filter((item) => item?.prompt && Array.isArray(item.options) && item.options.length)
    : [];

  if (questions.length === 0) return null;

  return {
    enabled: true,
    mode: 'qualification',
    quizId: 'guided-review-qualification',
    version: 1,
    intro: {
      headline: guidedReview.questions.title,
      subhead: guidedReview.questions.body,
      ctaLabel: guidedReview.questions.ctaLabel || 'Start the check',
    },
    steps: questions.map((question, questionIndex) => ({
      id: question.id || `question-${questionIndex + 1}`,
      questions: [{
        id: question.id || `question-${questionIndex + 1}`,
        prompt: question.prompt,
        type: 'single',
        weight: 1,
        options: question.options.map((option, optionIndex) => ({
          id: slug(option, `option-${optionIndex + 1}`),
          label: option,
          scores: {},
        })),
      }],
    })),
    scoring: {
      method: 'profile-sum',
      profileOrder: [],
      readiness: { enabled: false },
      leadScore: { enabled: false },
    },
    resultProfiles: [],
  };
}
