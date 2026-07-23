import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api/entities', () => ({ Campaign: { update: vi.fn() } }));
vi.mock('@/api/integrations', () => ({ UploadFile: vi.fn() }));

import { UploadFile } from '@/api/integrations';
import useStudioDoc from '../useStudioDoc';
import PagePanel from '../panels/PagePanel';
import ThemePanel from '../panels/ThemePanel';

let latestDoc = null;

function Harness({ v1, Panel }) {
  const s = useStudioDoc({ id: 'c1', name: 'FairPrice Voucher', design_config: v1 });
  latestDoc = s.doc;
  if (!s.doc) return null;
  return <Panel doc={s.doc} setPath={s.setPath} mut={s.mut} />;
}

const BASE_V1 = {
  formHeadline: 'Old headline',
  imageUrl: '/uploads/old.jpg',
  videoUrl: '/uploads/old.mp4',
  mediaType: 'image',
  themeColor: '#D17029',
  customerHost: 'redeem',
};

beforeEach(() => {
  vi.clearAllMocks();
  latestDoc = null;
});

describe('PagePanel — doc round-trips', () => {
  it('edits identity fields at their v2 paths with LIMITS counters', async () => {
    const user = userEvent.setup();
    render(<Harness v1={BASE_V1} Panel={PagePanel} />);
    const headline = screen.getByLabelText('Form headline');
    expect(headline).toHaveValue('Old headline');
    await user.clear(headline);
    await user.type(headline, 'Fresh headline');
    expect(latestDoc.content.headline).toBe('Fresh headline');
    expect(screen.getByText('14/80')).toBeInTheDocument();
  });

  it('template switching preserves the whole params bag (content is never lost)', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{ ...BASE_V1, formWidth: 420 }} Panel={PagePanel} />);
    expect(latestDoc.template.params.editorial.formWidth).toBe(420);
    await user.click(screen.getByRole('button', { name: /Poster/ }));
    expect(latestDoc.template.id).toBe('poster');
    expect(latestDoc.template.params.editorial.formWidth).toBe(420); // bag intact
    await user.click(screen.getByRole('button', { name: /Editorial/ }));
    expect(latestDoc.template.id).toBe('editorial');
    expect(latestDoc.template.params.editorial.formWidth).toBe(420);
  });

  it('the editorial form-width slider writes the template param', () => {
    render(<Harness v1={BASE_V1} Panel={PagePanel} />);
    const slider = screen.getByLabelText(/Form width/);
    // range inputs need a change event, not typing
    slider.focus();
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(slider, '560');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(latestDoc.template.params.editorial.formWidth).toBe(560);
  });

  it('the submit-button size slider defaults to 16 and writes content.submitFontSize', () => {
    render(<Harness v1={BASE_V1} Panel={PagePanel} />);
    const slider = screen.getByLabelText(/Submit button text size/);
    expect(slider).toHaveValue('16'); // absent in the doc → the funnel default
    expect(latestDoc.content?.submitFontSize).toBeUndefined(); // rendering ≠ writing
    slider.focus();
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(slider, '21');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(latestDoc.content.submitFontSize).toBe(21);
  });

  it('media-kind changes PRESERVE the legacy shadow (exact-downgrade contract)', async () => {
    const user = userEvent.setup();
    render(<Harness v1={BASE_V1} Panel={PagePanel} />);
    expect(latestDoc.content.media.legacy).toEqual({ imageUrl: '/uploads/old.jpg', videoUrl: '/uploads/old.mp4' });
    await user.click(screen.getByRole('button', { name: 'YouTube' }));
    expect(latestDoc.content.media.kind).toBe('youtube');
    expect(latestDoc.content.media.legacy).toEqual({ imageUrl: '/uploads/old.jpg', videoUrl: '/uploads/old.mp4' });
  });

  it('detects a recognizable YouTube URL and flags an unrecognizable one', async () => {
    const user = userEvent.setup();
    render(<Harness v1={BASE_V1} Panel={PagePanel} />);
    await user.click(screen.getByRole('button', { name: 'YouTube' }));
    const url = screen.getByLabelText('YouTube URL');
    await user.type(url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(screen.getByText(/✓ Recognized YouTube video \(dQw4w9WgXcQ\)/)).toBeInTheDocument();
    await user.clear(url);
    await user.type(url, 'https://example.com/clip');
    expect(screen.getByText(/Not a recognizable YouTube URL/)).toBeInTheDocument();
  });

  it('warns when a hero CTA label exists without media', async () => {
    const user = userEvent.setup();
    render(<Harness v1={{ ...BASE_V1, heroCtaLabel: 'Claim →', mediaType: 'none', imageUrl: undefined }} Panel={PagePanel} />);
    expect(screen.getByText(/Hero button label is set but there is no media/)).toBeInTheDocument();
    const cta = screen.getByLabelText('Hero button label');
    await user.clear(cta);
    expect(screen.queryByText(/Hero button label is set but there is no media/)).not.toBeInTheDocument();
  });

  it('image upload goes through the existing UploadFile integration and lands in media.src', async () => {
    UploadFile.mockResolvedValue({ file: { url: '/uploads/new-hero.jpg' } });
    const user = userEvent.setup();
    const { container } = render(<Harness v1={BASE_V1} Panel={PagePanel} />);
    const input = container.querySelector('[data-testid="studio-image-input"]');
    await user.upload(input, new File(['x'], 'hero.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(latestDoc.content.media.src).toBe('/uploads/new-hero.jpg'));
    expect(UploadFile).toHaveBeenCalledWith(expect.any(File), 'image');
    expect(latestDoc.content.media.kind).toBe('image');
  });
});

describe('ThemePanel — doc round-trips', () => {
  it('preset pick writes theme.preset; the parity baseline is labeled', async () => {
    const user = userEvent.setup();
    render(<Harness v1={BASE_V1} Panel={ThemePanel} />);
    expect(screen.getByText(/Warm Cream · parity/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Graphite/ }));
    expect(latestDoc.theme.preset).toBe('graphite');
  });

  it('corners "Preset" clears theme.radius so the preset rx override wins again', async () => {
    const user = userEvent.setup();
    render(<Harness v1={BASE_V1} Panel={ThemePanel} />);
    const corners = screen.getByRole('group', { name: 'Corners' });
    await user.click(within(corners).getByRole('button', { name: 'Round' }));
    expect(latestDoc.theme.radius).toBe('round');
    await user.click(within(corners).getByRole('button', { name: 'Preset' }));
    expect(latestDoc.theme).not.toHaveProperty('radius');
  });

  it('accent hex + contrast: a card-colored accent trips the <2:1 warning; Reset returns to the preset accent', async () => {
    const user = userEvent.setup();
    render(<Harness v1={BASE_V1} Panel={ThemePanel} />);
    const hex = screen.getByLabelText('Custom hex');
    await user.clear(hex);
    await user.type(hex, '#FFFAF0'); // warm-cream card color — unreadable accent
    expect(latestDoc.theme.accent).toBe('#FFFAF0');
    expect(screen.getByText(/Accent is hard to see on the card background/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(latestDoc.theme.accent).toBe(null);
    expect(screen.queryByText(/Accent is hard to see/)).not.toBeInTheDocument();
  });

  it('font selection writes theme.font', async () => {
    const user = userEvent.setup();
    render(<Harness v1={BASE_V1} Panel={ThemePanel} />);
    await user.click(screen.getByRole('radio', { name: /Space Grotesk/ }));
    expect(latestDoc.theme.font).toBe('space-grotesk');
  });
});
