import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The looks gallery mounts real mini-previews (DeviceFrame + CanvasPageSubject);
// here we assert the COMPOSED look doc reaches the mount, not iframe internals
// (DeviceFrame.test.jsx covers those).
vi.mock('../DeviceFrame', () => ({
  default: ({ children }) => <div data-testid="mock-frame">{children}</div>,
}));
vi.mock('../CanvasPageSubject', () => ({
  default: ({ doc }) => (
    <div data-testid="mock-page-subject" data-template={doc?.template?.id} data-headline={doc?.content?.headline} />
  ),
}));

import StudioAiPanel from '../StudioAiPanel';
import StudioRail from '../StudioRail';
import PagePanel from '../panels/PagePanel';

/**
 * Panel views per phase (PR 4 CP2) + the two entry points: the rail's
 * "✦ Write it for me" button and the per-field ✦ on the Page identity fields.
 * The panel is a pure view over the `ai` object — each phase is fed directly.
 */

function fakeAi(overrides = {}) {
  return {
    open: true,
    setOpen: vi.fn(),
    mode: 'copy',
    setMode: vi.fn(),
    phase: 'brief',
    brief: { topic: '', audience: '', objective: '', mustInclude: '', tone: 'Friendly' },
    setBrief: vi.fn(),
    sugs: [],
    recs: [],
    scope: null,
    looks: [],
    proposal: null,
    mediaHint: null,
    regeningLook: null,
    error: '',
    retryIn: 0,
    budget: { used: 0, max: 10 },
    generate: vi.fn(),
    suggestField: vi.fn(),
    acceptRow: vi.fn(),
    keepRow: vi.fn(),
    regenRow: vi.fn(),
    applyAll: vi.fn(),
    applySection: vi.fn(),
    applyRec: vi.fn(),
    jumpRec: vi.fn(),
    discard: vi.fn(),
    backToBrief: vi.fn(),
    generateLooks: vi.fn(),
    regenLook: vi.fn(),
    pickLook: vi.fn(),
    toggleKeep: vi.fn(),
    adoptLook: vi.fn(),
    revertLook: vi.fn(),
    notifySaved: vi.fn(),
    dismissMediaHint: vi.fn(),
    ...overrides,
  };
}

const BASE_DOC = {
  version: 2,
  template: { id: 'editorial', params: {} },
  theme: { preset: 'warm-cream', accent: null },
  content: { headline: 'Old headline', media: { kind: 'none', src: '', alt: '' } },
  distribution: { host: 'redeem' },
};

const LOOK = {
  name: 'Warm Editorial',
  rationale: 'Calm, trustworthy layout for a family audience.',
  template: { id: 'poster', params: { overlay: 'dusk' } },
  theme: { preset: 'ink-slate', accent: null },
  media: { kind: 'image', note: 'Warm family scene at a hawker centre' },
  draft: [{ path: 'content.headline', label: 'Form headline', section: 'page', value: 'Win your week of groceries' }],
};

const ROW = {
  path: 'content.headline',
  label: 'Form headline',
  section: 'page',
  value: 'Fresh AI headline',
  old: 'Old headline',
  state: 'open',
  disabledReason: null,
};

describe('StudioAiPanel', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<StudioAiPanel ai={fakeAi({ open: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('brief: Generate is disabled until the topic is filled; mode toggle switches to full', () => {
    const ai = fakeAi();
    render(<StudioAiPanel ai={ai} />);
    expect(screen.getByRole('button', { name: 'Generate suggestions' })).toBeDisabled();
    // create-everything amendment: the explainer now covers fields + T&Cs
    // drafting and keeps the never-yours-to-flip framing for switches.
    expect(screen.getByRole('button', { name: 'Fill everything' })).toBeInTheDocument();
    expect(screen.getByText(/sign-up field set and a Terms & Conditions draft/i)).toBeInTheDocument();
    expect(screen.getByText(/not legal advice/i)).toBeInTheDocument();
    expect(screen.getByText(/publication switches are only ever yours/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Design the whole page' }));
    expect(ai.setMode).toHaveBeenCalledWith('full');
    fireEvent.click(screen.getByRole('button', { name: 'Friendly' }));
    expect(ai.setBrief).toHaveBeenCalled();
  });

  it('brief in full mode: Generate looks fires generateLooks (not the copy generator)', () => {
    const ai = fakeAi({
      mode: 'full',
      brief: { topic: 'Voucher giveaway', audience: '', objective: '', mustInclude: '', tone: 'Friendly' },
    });
    render(<StudioAiPanel ai={ai} />);
    // amended disclaimer: distribution copy now belongs to the other tab, but
    // looks still never touch switches/fields/verification
    expect(screen.getByText(/publication switches are\s+never touched/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate looks' }));
    expect(ai.generateLooks).toHaveBeenCalled();
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('brief: with a topic, Generate fires', () => {
    const ai = fakeAi({ brief: { topic: 'Voucher giveaway', audience: '', objective: '', mustInclude: '', tone: 'Friendly' } });
    render(<StudioAiPanel ai={ai} />);
    const btn = screen.getByRole('button', { name: 'Generate suggestions' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(ai.generate).toHaveBeenCalled();
  });

  it('loading: shows the scoped label when a scope is set', () => {
    render(<StudioAiPanel ai={fakeAi({ phase: 'loading', scope: { path: 'content.headline', label: 'Form headline' } })} />);
    expect(screen.getByTestId('ai-loading').textContent).toMatch(/Form headline/);
  });

  it('ready: renders the row with struck-through old value and wires Accept / Keep mine / ↻', () => {
    const ai = fakeAi({ phase: 'ready', sugs: [ROW] });
    render(<StudioAiPanel ai={ai} />);

    expect(screen.getByText('Old headline')).toBeInTheDocument();
    expect(screen.getByText('Fresh AI headline')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(ai.acceptRow).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    expect(ai.keepRow).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: '↻' }));
    expect(ai.regenRow).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: 'Apply all remaining' }));
    expect(ai.applyAll).toHaveBeenCalled();
  });

  it('ready: a gated row shows its reason and Accept is disabled', () => {
    const gated = { ...ROW, path: 'distribution.featuredDrop.title', disabledReason: 'The featured drop is off' };
    render(<StudioAiPanel ai={fakeAi({ phase: 'ready', sugs: [gated] })} />);
    expect(screen.getByText('The featured drop is off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
  });

  it('error: shows the message with a retry that re-generates', () => {
    const ai = fakeAi({ phase: 'error', error: 'AI provider timed out.' });
    render(<StudioAiPanel ai={ai} />);
    expect(screen.getByText('AI provider timed out.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(ai.generate).toHaveBeenCalled();
  });

  it('rate: shows the countdown', () => {
    render(<StudioAiPanel ai={fakeAi({ phase: 'rate', retryIn: 42 })} />);
    expect(screen.getByText(/Rate limit reached/)).toBeInTheDocument();
    expect(screen.getByText('42s')).toBeInTheDocument();
  });

  it('budget meter renders the estimate', () => {
    render(<StudioAiPanel ai={fakeAi({ budget: { used: 3, max: 10 } })} />);
    expect(screen.getByText(/3\/10 this minute/)).toBeInTheDocument();
  });
});

describe('StudioAiPanel — full-coverage review (sections, picks, lists, recommendations)', () => {
  const PAGE_ROW = { ...ROW, section: 'Page' };
  const PICK_ROW = {
    path: 'distribution.marketplace.category',
    label: 'Category',
    section: 'Distribution',
    value: 'family_lifestyle',
    old: '',
    state: 'open',
    disabledReason: null,
    kind: 'pick',
  };
  const LIST_ROW = {
    path: 'distribution.marketplace.inclusions',
    label: 'Inclusions',
    section: 'Distribution',
    value: ['1 night stay', 'Daily photo updates'],
    old: [],
    state: 'open',
    disabledReason: null,
    kind: 'list',
  };
  const RECS = [
    { topic: 'listMarketplace', label: 'Marketplace listing', advice: 'Flip it on once the slug is set.', suggestedValue: 'on', state: 'open' },
    { topic: 'formGates', label: 'Eligibility gates', advice: 'Consider the SG/PR gate.', suggestedValue: null, state: 'open' },
  ];

  it('groups rows by section with per-section apply; single-section lists render no headers', () => {
    const ai = fakeAi({ phase: 'ready', sugs: [PAGE_ROW, PICK_ROW, LIST_ROW] });
    render(<StudioAiPanel ai={ai} />);

    expect(screen.getByText('PAGE · 1')).toBeInTheDocument();
    expect(screen.getByText('DISTRIBUTION · 2')).toBeInTheDocument();
    const sectionApplies = screen.getAllByRole('button', { name: 'Apply section' });
    expect(sectionApplies).toHaveLength(2);
    fireEvent.click(sectionApplies[1]);
    expect(ai.applySection).toHaveBeenCalledWith('Distribution');

    const { container } = render(<StudioAiPanel ai={fakeAi({ phase: 'ready', sugs: [PAGE_ROW] })} />);
    expect(container.textContent).not.toContain('PAGE · 1');
  });

  it('pick rows show the human category label and have no regenerate button', () => {
    render(<StudioAiPanel ai={fakeAi({ phase: 'ready', sugs: [PICK_ROW] })} />);
    expect(screen.getByText('Family & Lifestyle')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '↻' })).toBeNull();
  });

  it('list rows render bullets; array old renders struck bullets', () => {
    const withOld = { ...LIST_ROW, old: ['Old inclusion'] };
    render(<StudioAiPanel ai={fakeAi({ phase: 'ready', sugs: [withOld] })} />);
    expect(screen.getByText(/• 1 night stay/)).toBeInTheDocument();
    expect(screen.getByText(/• Old inclusion/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '↻' })).toBeInTheDocument(); // lists DO regen
  });

  it('recommendation cards are advisory: Apply-to-draft only with a suggestedValue, Go-to-control always', () => {
    const ai = fakeAi({ phase: 'ready', sugs: [PAGE_ROW], recs: RECS });
    render(<StudioAiPanel ai={ai} />);

    expect(screen.getByTestId('ai-recs')).toBeInTheDocument();
    expect(screen.getByText('RECOMMENDATIONS — ADVISORY')).toBeInTheDocument();
    expect(screen.getByText(/Flip it on once the slug is set/)).toBeInTheDocument();
    expect(screen.getByText('suggested: on')).toBeInTheDocument();

    // one Apply (the toggle rec) — the advice-only card offers none
    const applies = screen.getAllByRole('button', { name: 'Apply to draft' });
    expect(applies).toHaveLength(1);
    fireEvent.click(applies[0]);
    expect(ai.applyRec).toHaveBeenCalledWith(0);

    const jumps = screen.getAllByRole('button', { name: 'Go to control' });
    expect(jumps).toHaveLength(2);
    fireEvent.click(jumps[1]);
    expect(ai.jumpRec).toHaveBeenCalledWith(1);
  });

  it('an applied recommendation shows the applied chip and loses its Apply button', () => {
    const applied = [{ ...RECS[0], state: 'applied' }];
    render(<StudioAiPanel ai={fakeAi({ phase: 'ready', sugs: [PAGE_ROW], recs: applied })} />);
    expect(screen.getByText('✓ APPLIED TO DRAFT')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply to draft' })).toBeNull();
  });

  it('customerHost cards always carry the trusted blast-radius warning (Codex #197-3)', () => {
    const hostRec = [{ topic: 'customerHost', label: 'Customer domain', advice: 'Use redeem.sg.', suggestedValue: 'redeem', state: 'open' }];
    render(<StudioAiPanel ai={fakeAi({ phase: 'ready', sugs: [PAGE_ROW], recs: hostRec })} />);
    expect(screen.getByText(/chrome, pixels, regulatory copy and the confirmation-email/i)).toBeInTheDocument();
    expect(screen.getByText(/written for the current domain's voice/i)).toBeInTheDocument();
  });

  it('a receipt-time gated row re-enables from the LIVE doc (Codex #198-5)', () => {
    const gatedQuizRow = {
      path: 'quiz.intro.headline',
      label: 'Quiz intro headline',
      section: 'Quiz',
      value: 'AI quiz intro',
      old: '',
      state: 'open',
      disabledReason: 'The quiz is disabled or has no questions', // receipt-time
    };
    const quizOnDoc = {
      ...BASE_DOC,
      quiz: { enabled: true, steps: [{ questions: [{ id: 'q1' }] }] },
    };
    // surface enabled since receipt → Accept must be live again
    render(<StudioAiPanel ai={fakeAi({ phase: 'ready', sugs: [gatedQuizRow] })} campaign={{ id: 'c1' }} doc={quizOnDoc} />);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
    expect(screen.queryByText('The quiz is disabled or has no questions')).toBeNull();

    // still off → stays blocked
    render(<StudioAiPanel ai={fakeAi({ phase: 'ready', sugs: [gatedQuizRow] })} campaign={{ id: 'c1' }} doc={BASE_DOC} />);
    expect(screen.getAllByRole('button', { name: 'Accept' })[1]).toBeDisabled();
  });
});

describe('StudioAiPanel — looks gallery + proposal (CO-1)', () => {
  it('looks: each card mounts a mini-preview fed the COMPOSED look doc and wires pick/regen', () => {
    const ai = fakeAi({ phase: 'looks', looks: [LOOK] });
    render(<StudioAiPanel ai={ai} campaign={{ id: 'c1' }} doc={BASE_DOC} />);

    // the preview receives buildLookDoc(base, look): template swapped + copy applied
    const subject = screen.getByTestId('mock-page-subject');
    expect(subject.dataset.template).toBe('poster');
    expect(subject.dataset.headline).toBe('Win your week of groceries');

    expect(screen.getByText('Warm Editorial')).toBeInTheDocument();
    expect(screen.getByText(/Art direction: Warm family scene/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use this look' }));
    expect(ai.pickLook).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: '↻' }));
    expect(ai.regenLook).toHaveBeenCalledWith(0);
  });

  it('looks: a spotlight look is blocked (with reason) while the unsaved quiz is off', () => {
    const spotlightLook = { ...LOOK, name: 'Quiz Tease', template: { id: 'spotlight', params: {} } };
    const ai = fakeAi({ phase: 'looks', looks: [spotlightLook] });
    render(<StudioAiPanel ai={ai} campaign={{ id: 'c1' }} doc={BASE_DOC} />);

    expect(screen.getByRole('button', { name: 'Use this look' })).toBeDisabled();
    expect(screen.getAllByText(/Spotlight needs the quiz/).length).toBeGreaterThan(0);
  });

  it('proposal: keep toggles + adopt + discard wire through', () => {
    const proposal = {
      prev: { doc: BASE_DOC },
      look: LOOK,
      keep: { template: false, theme: false, copy: false },
      adopted: false,
    };
    const ai = fakeAi({ phase: 'proposal', proposal });
    render(<StudioAiPanel ai={ai} campaign={{ id: 'c1' }} doc={BASE_DOC} />);

    expect(screen.getByText('PROPOSAL — UNCOMMITTED')).toBeInTheDocument();
    // previous names surface on the keep toggles
    expect(screen.getByText(/Keep my template \(Editorial\)/)).toBeInTheDocument();
    expect(screen.getByText(/Keep my theme \(warm-cream\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Keep my template/));
    expect(ai.toggleKeep).toHaveBeenCalledWith('template');
    fireEvent.click(screen.getByRole('button', { name: 'Adopt this look' }));
    expect(ai.adoptLook).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(ai.revertLook).toHaveBeenCalled();
  });
});

describe('PagePanel — AI art-direction chip', () => {
  it('renders the dismissible media hint in HERO MEDIA', () => {
    const onDismiss = vi.fn();
    render(
      <PagePanel
        doc={BASE_DOC}
        setPath={() => {}}
        mut={() => {}}
        mediaHint={{ kind: 'image', note: 'Warm family scene' }}
        onDismissMediaHint={onDismiss}
      />
    );
    expect(screen.getByTestId('studio-media-hint').textContent).toMatch(/Warm family scene/);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss art direction' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders no chip without a hint', () => {
    render(<PagePanel doc={BASE_DOC} setPath={() => {}} mut={() => {}} />);
    expect(screen.queryByTestId('studio-media-hint')).toBeNull();
  });
});

describe('AI entry points', () => {
  it('StudioRail renders "✦ Write it for me" only when onAi is provided', () => {
    const onAi = vi.fn();
    const { rerender } = render(
      <StudioRail section="page" onSection={() => {}} onOpenJson={() => {}} onAi={onAi} />
    );
    fireEvent.click(screen.getByRole('button', { name: '✦ Write it for me' }));
    expect(onAi).toHaveBeenCalled();

    rerender(<StudioRail section="page" onSection={() => {}} onOpenJson={() => {}} onAi={null} />);
    expect(screen.queryByRole('button', { name: '✦ Write it for me' })).toBeNull();
  });

  it('PagePanel puts a ✦ on exactly the five identity fields (none without onSuggest)', () => {
    const doc = {
      version: 2,
      template: { id: 'editorial', params: {} },
      theme: { preset: 'warm-cream', accent: null },
      content: { headline: 'H', media: { kind: 'none', src: '', alt: '' } },
    };
    const onSuggest = vi.fn();
    const { rerender } = render(<PagePanel doc={doc} setPath={() => {}} mut={() => {}} onSuggest={onSuggest} />);

    const stars = screen.getAllByRole('button', { name: /^AI suggest — / });
    expect(stars).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'AI suggest — Hero story' }));
    expect(onSuggest).toHaveBeenCalledWith('content.story', 'Hero story');

    rerender(<PagePanel doc={doc} setPath={() => {}} mut={() => {}} />);
    expect(screen.queryAllByRole('button', { name: /^AI suggest — / })).toHaveLength(0);
  });
});

describe('create-everything amendment — fields + terms rows render', () => {
  const FIELDS_ROW = {
    path: 'form.fields', label: 'Sign-up fields', section: 'Form', kind: 'fields', state: 'open',
    value: [
      { id: 'name', visible: true, required: true },
      { id: 'dob', visible: true, required: false },
      { id: 'salary', visible: false, required: false },
    ],
    old: [], oldAbsent: true, disabledReason: null,
  };
  const TERMS_ROW = {
    path: 'form.terms', label: 'Terms & Conditions (draft)', section: 'Form', kind: 'terms', state: 'open',
    value: { template: 'privacy', html: '<p>' + 'clause '.repeat(50) + '</p>' },
    old: '', oldAbsent: true, disabledReason: null,
  };

  it('fields rows render a readable summary (never [object Object]) and no regen button', () => {
    const ai = fakeAi({ phase: 'ready', sugs: [FIELDS_ROW] });
    render(<StudioAiPanel ai={ai} />);
    const card = screen.getByTestId('ai-sug-form.fields');
    expect(card.textContent).toContain('Name');
    expect(card.textContent).toContain('Date of birth (optional)');
    expect(card.textContent).toContain('Hidden: Salary');
    expect(card.textContent).not.toContain('[object Object]');
    expect(card.querySelector('[title="Regenerate this field"]')).toBeNull();
  });

  it('terms rows render the template chip, an excerpt, and the legal-draft framing', () => {
    const ai = fakeAi({ phase: 'ready', sugs: [TERMS_ROW] });
    render(<StudioAiPanel ai={ai} />);
    const card = screen.getByTestId('ai-sug-form.terms');
    expect(card.textContent).toContain('template: privacy');
    expect(card.textContent).toContain('clause');
    expect(card.textContent).toContain('not legal advice');
    expect(card.querySelector('[title="Regenerate this field"]')).toBeNull();
  });

  it('deterministic draw terms rows say so instead of the legal-draft warning', () => {
    const ai = fakeAi({ phase: 'ready', sugs: [{ ...TERMS_ROW, deterministic: true, label: 'Draw Terms & Conditions (platform template)' }] });
    render(<StudioAiPanel ai={ai} />);
    const card = screen.getByTestId('ai-sug-form.terms');
    expect(card.textContent).toContain('Platform draw-terms template');
    expect(card.textContent).not.toContain('not legal advice');
  });
});
