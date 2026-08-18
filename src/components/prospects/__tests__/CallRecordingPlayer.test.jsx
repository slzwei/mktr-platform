import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import CallRecordingPlayer from '../CallRecordingPlayer';

const MONO = 'https://cdn.retell/recording.wav';
const SPLIT = 'https://cdn.retell/recording_multichannel.wav';

/**
 * Minimal Web Audio stand-in. jsdom ships no AudioContext, so the component's
 * fallback path is what runs unless a test installs this.
 */
function installAudioContext() {
  const gains = [];
  const makeGain = () => {
    const node = { gain: { value: 1 }, connect: vi.fn() };
    gains.push(node);
    return node;
  };
  const ctx = {
    state: 'running',
    destination: {},
    close: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
    createChannelSplitter: vi.fn(() => ({ connect: vi.fn() })),
    createChannelMerger: vi.fn(() => ({ connect: vi.fn() })),
    createGain: vi.fn(makeGain),
    createDynamicsCompressor: vi.fn(() => ({
      threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect: vi.fn(),
    })),
  };
  // Must be newable — the component calls `new AudioContext()`.
  window.AudioContext = vi.fn(function AudioContextStub() { return ctx; });
  // Gains are created callee-first, matching the component's wiring order.
  return { ctx, calleeGain: () => gains[0], agentGain: () => gains[1] };
}

afterEach(() => {
  delete window.AudioContext;
  vi.restoreAllMocks();
});

describe('CallRecordingPlayer', () => {
  it('renders nothing without a recording', () => {
    const { container } = render(<CallRecordingPlayer />);
    expect(container).toBeEmptyDOMElement();
  });

  it('plays the mono mix untouched when there is no split recording', () => {
    const { container } = render(<CallRecordingPlayer src={MONO} />);
    expect(container.querySelector('audio')).toHaveAttribute('src', MONO);
    expect(screen.queryByLabelText(/callee boost/i)).not.toBeInTheDocument();
  });

  it('falls back to plain playback of the split file when Web Audio is absent', () => {
    const { container } = render(<CallRecordingPlayer src={MONO} multiChannelSrc={SPLIT} />);
    // jsdom has no AudioContext — the split file still plays, just unboosted.
    expect(container.querySelector('audio')).toHaveAttribute('src', SPLIT);
    expect(screen.queryByLabelText(/callee boost/i)).not.toBeInTheDocument();
  });

  it('boosts the callee channel by +8 dB by default', async () => {
    const audio = installAudioContext();
    render(<CallRecordingPlayer src={MONO} multiChannelSrc={SPLIT} />);

    await waitFor(() => expect(screen.getByLabelText(/callee boost/i)).toBeInTheDocument());
    // +8 dB and −2 dB in linear gain.
    expect(audio.calleeGain().gain.value).toBeCloseTo(10 ** (8 / 20), 5);
    expect(audio.agentGain().gain.value).toBeCloseTo(10 ** (-2 / 20), 5);
    expect(screen.getByText('+8 dB')).toBeInTheDocument();
  });

  it('retunes the callee gain when the slider moves', async () => {
    const audio = installAudioContext();
    render(<CallRecordingPlayer src={MONO} multiChannelSrc={SPLIT} />);

    const slider = await screen.findByLabelText(/callee boost/i);
    // jsdom doesn't step a range input from arrow keys — drive its value directly.
    fireEvent.change(slider, { target: { value: '10' } });

    await waitFor(() => expect(audio.calleeGain().gain.value).toBeCloseTo(10 ** (10 / 20), 5));
    expect(screen.getByText('+10 dB')).toBeInTheDocument();
  });

  it('resumes a suspended context on play so the graph is audible', async () => {
    const audio = installAudioContext();
    audio.ctx.state = 'suspended';
    const { container } = render(<CallRecordingPlayer src={MONO} multiChannelSrc={SPLIT} />);

    await waitFor(() => expect(screen.getByLabelText(/callee boost/i)).toBeInTheDocument());
    container.querySelector('audio').dispatchEvent(new Event('play'));
    expect(audio.ctx.resume).toHaveBeenCalled();
  });
});
