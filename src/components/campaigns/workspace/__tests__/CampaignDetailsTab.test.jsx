import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import CampaignDetailsTab from '../CampaignDetailsTab';

afterEach(cleanup);

describe('CampaignDetailsTab', () => {
  it('submits a payload carrying type, enforceLeadQuota and pixel ids', () => {
    const onSubmit = vi.fn();
    render(
      <CampaignDetailsTab initial={null} type="quiz" isEdit={false} saving={false} onSubmit={onSubmit} />
    );

    fireEvent.change(screen.getByLabelText('Campaign name'), { target: { value: 'My Campaign' } });
    fireEvent.change(screen.getByLabelText('Meta Pixel ID'), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText('TikTok Pixel ID'), { target: { value: 'TT9' } });
    fireEvent.change(screen.getByLabelText(/Lead price/i), { target: { value: '8.5' } });
    fireEvent.click(screen.getByRole('switch')); // enforce quota on

    fireEvent.click(screen.getByRole('button', { name: /Create draft/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'My Campaign',
      type: 'quiz',
      enforceLeadQuota: true,
      leadPriceCents: 850,
      metaPixelId: '123',
      tiktokPixelId: 'TT9',
    });
  });

  it('blank lead price submits null (campaign closed to commitments); stored cents round-trip to dollars', () => {
    const onSubmit = vi.fn();
    render(
      <CampaignDetailsTab
        initial={{ name: 'Priced', type: 'lead_generation', leadPriceCents: 1200 }}
        isEdit
        saving={false}
        onSubmit={onSubmit}
      />
    );
    // 1200 cents renders as 12 dollars
    expect(screen.getByLabelText(/Lead price/i).value).toBe('12');
    // clearing it sends null
    fireEvent.change(screen.getByLabelText(/Lead price/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Save details/i }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ leadPriceCents: null });
  });

  it('preserves the existing type in edit mode and shows Save details', () => {
    const onSubmit = vi.fn();
    render(
      <CampaignDetailsTab
        initial={{ name: 'Existing', type: 'lead_generation', enforceLeadQuota: false }}
        isEdit
        saving={false}
        onSubmit={onSubmit}
      />
    );

    const saveBtn = screen.getByRole('button', { name: /Save details/i });
    expect(saveBtn).toBeTruthy();
    fireEvent.click(saveBtn);

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Existing',
      type: 'lead_generation',
      enforceLeadQuota: false,
    });
  });

  it('does not submit when the name is empty', () => {
    const onSubmit = vi.fn();
    render(<CampaignDetailsTab initial={null} type="lead_generation" isEdit={false} saving={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /Create draft/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
