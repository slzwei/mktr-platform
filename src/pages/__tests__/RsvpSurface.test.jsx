/**
 * The rsvp.redeem.sg route table (docs/plans/rsvp-pages.md §7): with
 * VITE_SURFACE=rsvp the SPA is ONE page — /:slug renders the event, anything
 * else is the "not live" screen, and no ad tracker mounts.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clampLayout } from '@/lib/rsvpLayout';

const api = vi.hoisted(() => ({ fetchPublicRsvp: vi.fn(), submitRsvp: vi.fn(), sendRsvpPhoneCode: vi.fn(), checkRsvpPhoneCode: vi.fn() }));
vi.mock('@/api/rsvpPublic', () => api);
vi.mock('@/components/AdRollRouteTracker', () => ({ default: () => <div data-testid="adroll-tracker" /> }));

const DTO = {
  slug: 'launch', title: 'Launch night', organiserName: 'Acme', state: 'open', closesAt: null,
  layout: clampLayout({ blocks: [{ id: 'b_h', type: 'hero', headline: 'Launch night' }, { type: 'form' }] }),
  consent: { version: 'v1', copy: 'I agree.' },
};

async function loadPages(path) {
  vi.resetModules();
  vi.stubEnv('VITE_SURFACE', 'rsvp');
  vi.stubEnv('VITE_BRAND', 'redeem');
  window.history.pushState({}, '', path);
  const mod = await import('@/pages/index.jsx');
  return mod.default;
}

beforeEach(() => { vi.clearAllMocks(); api.fetchPublicRsvp.mockResolvedValue(DTO); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('rsvp surface', () => {
  it('/:slug renders the event page through the shared renderer, with no ad tracker mounted', async () => {
    const Pages = await loadPages('/launch');
    render(<Pages />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Launch night' })).toBeInTheDocument();
    expect(api.fetchPublicRsvp).toHaveBeenCalledWith('launch');
    expect(screen.queryByTestId('adroll-tracker')).not.toBeInTheDocument();
  });

  it('the apex and any deeper path are the "not live" screen — nothing else is registered', async () => {
    const Pages = await loadPages('/');
    render(<Pages />);
    expect(await screen.findByRole('heading', { name: /isn.t live/ })).toBeInTheDocument();
    expect(api.fetchPublicRsvp).not.toHaveBeenCalled();
  });
});
