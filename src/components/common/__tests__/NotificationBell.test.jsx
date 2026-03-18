import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NotificationBell from '@/components/layout/NotificationBell';

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, value) => {
    store[key] = String(value);
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the bell trigger button', () => {
    render(<NotificationBell />);
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
  });

  it('shows unread count badge', () => {
    render(<NotificationBell />);
    // Mock notifications are generated, so there should be a count badge
    const badge = screen.queryByText(/[0-9]/);
    expect(badge).not.toBeNull();
  });

  it('opens notification popover on click', async () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Notifications')).toBeInTheDocument();
  });

  it('shows notification messages when popover is open', async () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(/Sarah Chen/)).toBeInTheDocument();
  });

  it('shows Mark all read button when there are unread notifications', async () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Mark all read')).toBeInTheDocument();
  });

  it('renders relative time for notifications', async () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button'));
    // At least one notification should show a relative time like "12m ago"
    const timeLabels = await screen.findAllByText(/ago|Just now/);
    expect(timeLabels.length).toBeGreaterThan(0);
  });

  it('renders different notification type icons', async () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button'));
    // Notifications contain prospect, commission, campaign, system types
    const items = await screen.findAllByText(/Commission|Campaign|prospect|System|Sarah|James/i);
    expect(items.length).toBeGreaterThan(0);
  });
});
