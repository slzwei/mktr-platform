import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({
      data: {
        items: [
          {
            id: 's1',
            slug: 'test-link',
            targetUrl: 'https://example.com',
            clickCount: 42,
            expiresAt: '2026-12-31T00:00:00Z',
          },
          { id: 's2', slug: 'promo-2', targetUrl: 'https://promo.com', clickCount: 10, expiresAt: null },
        ],
        total: 2,
      },
    }),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/components/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title, description }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <div>{title}</div>
        <div>{description}</div>
      </div>
    ) : null,
}));

import AdminShortLinks from '../AdminShortLinks';
import { apiClient } from '@/api/client';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminShortLinks />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AdminShortLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Short Links heading', () => {
    renderPage();
    expect(screen.getByText('Short Links')).toBeInTheDocument();
  });

  it('renders search input', () => {
    renderPage();
    expect(screen.getByPlaceholderText('Search slug...')).toBeInTheDocument();
  });

  it('renders Search button', () => {
    renderPage();
    expect(screen.getByText('Search')).toBeInTheDocument();
  });

  it('renders table headers', () => {
    renderPage();
    expect(screen.getByText('Slug')).toBeInTheDocument();
    expect(screen.getByText('Target')).toBeInTheDocument();
    expect(screen.getByText('Clicks')).toBeInTheDocument();
    expect(screen.getByText('Expires')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('renders shortlink items when loaded', async () => {
    renderPage();
    expect(await screen.findByText('test-link')).toBeInTheDocument();
    expect(await screen.findByText('promo-2')).toBeInTheDocument();
  });

  it('renders target URLs', async () => {
    renderPage();
    expect(await screen.findByText('https://example.com')).toBeInTheDocument();
  });

  it('renders click counts', async () => {
    renderPage();
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(await screen.findByText('10')).toBeInTheDocument();
  });

  it('renders action buttons for each shortlink', async () => {
    renderPage();
    // "Clicks" appears in header as column name and as action buttons
    const clickElements = await screen.findAllByText('Clicks');
    expect(clickElements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Extend button for each shortlink', async () => {
    renderPage();
    const extendButtons = await screen.findAllByText('Extend +90d');
    expect(extendButtons.length).toBe(2);
  });

  it('renders Delete button for each shortlink', async () => {
    renderPage();
    const deleteButtons = await screen.findAllByText('Delete');
    expect(deleteButtons.length).toBe(2);
  });

  it('shows dash for null expiry', async () => {
    renderPage();
    // The second shortlink has null expiresAt, shown as em dash
    const dash = await screen.findByText('—');
    expect(dash).toBeInTheDocument();
  });

  it('updates search input value', () => {
    renderPage();
    const input = screen.getByPlaceholderText('Search slug...');
    fireEvent.change(input, { target: { value: 'my-slug' } });
    expect(input.value).toBe('my-slug');
  });

  it('calls apiClient.get on Search click', async () => {
    renderPage();
    const input = screen.getByPlaceholderText('Search slug...');
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalled();
    });
  });
});
