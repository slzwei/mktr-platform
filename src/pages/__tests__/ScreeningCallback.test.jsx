import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// The page talks straight to apiClient — stub the whole module.
vi.mock('@/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

import { apiClient } from '@/api/client';
import ScreeningCallback from '../ScreeningCallback';

const TOKEN = `wcb_${'a'.repeat(32)}`;

function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/callback" element={<ScreeningCallback />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ScreeningCallback (/callback?t=…)', () => {
  it('ready state pitches ×N and books a window on tap', async () => {
    apiClient.get.mockResolvedValue({
      data: { state: 'ready', firstName: 'Shawn', drawName: 'iPhone 17 Pro Lucky Draw', multiplier: 10 },
    });
    apiClient.post.mockResolvedValue({
      data: { ok: true, state: 'scheduled', window: 'tomorrow', scheduledFor: '2026-07-26T02:00:00.000Z' },
    });
    renderAt(`/callback?t=${TOKEN}`);

    expect(await screen.findByText(/sorry we missed you/i)).toBeInTheDocument();
    expect(screen.getByText(/×10 chances/)).toBeInTheDocument();
    expect(screen.getByText('iPhone 17 Pro Lucky Draw')).toBeInTheDocument();
    // The tap is the consent — the fine print must say so.
    expect(screen.getByText(/agreeing to a call/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /tomorrow/i }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      `/screening-callback/${TOKEN}`, { window: 'tomorrow' },
    ));
    expect(await screen.findByText(/we'll call you/i)).toBeInTheDocument();
    // 2026-07-26T02:00Z = 10:00 SGT — the shown time is SGT, not UTC.
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
  });

  it('missing or short token renders expired without calling the API', async () => {
    renderAt('/callback?t=short');
    expect(await screen.findByText(/link has expired/i)).toBeInTheDocument();
    expect(screen.getByText(/entry still stands/i)).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('404 renders expired; done and in_flight render their states', async () => {
    apiClient.get.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
    renderAt(`/callback?t=${TOKEN}`);
    expect(await screen.findByText(/link has expired/i)).toBeInTheDocument();

    apiClient.get.mockResolvedValueOnce({ data: { state: 'done', firstName: 'Shawn' } });
    renderAt(`/callback?t=${TOKEN}`);
    expect(await screen.findByText(/all set, Shawn/i)).toBeInTheDocument();

    apiClient.get.mockResolvedValueOnce({ data: { state: 'in_flight' } });
    renderAt(`/callback?t=${TOKEN}`);
    expect(await screen.findByText(/calling you right now/i)).toBeInTheDocument();
  });
});
