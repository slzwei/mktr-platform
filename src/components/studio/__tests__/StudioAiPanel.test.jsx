import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
    scope: null,
    error: '',
    retryIn: 0,
    budget: { used: 0, max: 10 },
    generate: vi.fn(),
    suggestField: vi.fn(),
    acceptRow: vi.fn(),
    keepRow: vi.fn(),
    regenRow: vi.fn(),
    applyAll: vi.fn(),
    discard: vi.fn(),
    backToBrief: vi.fn(),
    ...overrides,
  };
}

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

  it('brief: Generate is disabled until the topic is filled; full mode toggle is gated off (CP3)', () => {
    const ai = fakeAi();
    render(<StudioAiPanel ai={ai} />);
    expect(screen.getByRole('button', { name: 'Generate suggestions' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Design the whole page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Friendly' }));
    expect(ai.setBrief).toHaveBeenCalled();
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
