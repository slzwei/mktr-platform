import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StudioTopBar, { deriveSaveStatus } from '../StudioTopBar';

const baseProps = {
  campaign: { id: 'c1', name: 'FairPrice Voucher', status: 'active' },
  campaigns: [
    { id: 'c1', name: 'FairPrice Voucher', status: 'active' },
    { id: 'c2', name: 'Tokyo Draw', status: 'draft' },
  ],
  savedHostName: 'redeem.sg',
  dirty: false,
  saving: false,
  savedAt: null,
  saveError: null,
  isStoredV1: false,
  drawInfo: undefined,
  onSave: vi.fn(),
  onSwitchCampaign: vi.fn(),
  onBack: vi.fn(),
  onCopyLink: vi.fn(),
  onSharePreview: vi.fn(),
};

describe('deriveSaveStatus — the honesty state machine', () => {
  const base = { saving: false, dirty: false, savedAt: null, isStoredV1: false, campaignStatus: 'active', savedHostName: 'redeem.sg' };
  it.each([
    [{ ...base, saving: true }, 'Saving…'],
    [{ ...base, dirty: true }, 'Unsaved changes'],
    [{ ...base, savedAt: 1 }, 'Saved · live on redeem.sg'],
    [{ ...base, savedAt: 1, campaignStatus: 'draft' }, 'Saved (draft — goes live with the campaign)'],
    [{ ...base }, 'No changes'],
    [
      { ...base, isStoredV1: true },
      'No changes · first save upgrades this campaign to the Studio format',
    ],
  ])('%# → %s', (input, expected) => {
    expect(deriveSaveStatus(input)).toBe(expected);
  });

  it('never claims "live on" for a non-active campaign', () => {
    expect(
      deriveSaveStatus({ ...base, savedAt: 5, campaignStatus: 'paused' })
    ).not.toContain('live on');
  });
});

describe('StudioTopBar', () => {
  it('renders status chip, disables Save when clean, and shows the draw chip only for enabled draws', () => {
    const { rerender } = render(<StudioTopBar {...baseProps} />);
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.queryByText(/DRAW · CLOSES/)).not.toBeInTheDocument();

    rerender(<StudioTopBar {...baseProps} dirty drawInfo={{ enabled: true, closesAt: '2026-10-30' }} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByText(/DRAW · CLOSES 30 OCT/)).toBeInTheDocument();
  });

  it('surfaces the save error message in the status slot', () => {
    render(
      <StudioTopBar
        {...baseProps}
        saveError={{ kind: 'writes-gated', message: 'The server has not enabled Campaign Studio saves yet.' }}
      />
    );
    expect(screen.getByTestId('studio-save-status')).toHaveTextContent(
      'The server has not enabled Campaign Studio saves yet.'
    );
  });

  it('routes switcher changes and the guarded actions to their handlers', async () => {
    const user = userEvent.setup();
    render(<StudioTopBar {...baseProps} />);
    await user.selectOptions(screen.getByLabelText('Switch campaign'), 'c2');
    expect(baseProps.onSwitchCampaign).toHaveBeenCalledWith('c2');
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(baseProps.onCopyLink).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Share preview' }));
    expect(baseProps.onSharePreview).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '← Campaign' }));
    expect(baseProps.onBack).toHaveBeenCalled();
  });
});
