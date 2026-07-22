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

describe('CampaignDetailsTab — lucky-draw create flow', () => {
  const fillBasics = () => {
    fireEvent.change(screen.getByLabelText('Campaign name'), { target: { value: 'iPhone Lucky Draw' } });
    fireEvent.change(screen.getByLabelText('Prize'), { target: { value: 'One (1) iPhone 17 Pro' } });
    fireEvent.change(screen.getByLabelText('Entries close'), { target: { value: '2026-08-31' } });
  };

  it('renders the draw card only when draw is set', () => {
    const { unmount } = render(
      <CampaignDetailsTab initial={null} type="lead_generation" isEdit={false} saving={false} onSubmit={vi.fn()} />
    );
    expect(screen.queryByTestId('draw-setup-card')).not.toBeInTheDocument();
    unmount();
    render(
      <CampaignDetailsTab initial={null} type="lead_generation" draw isEdit={false} saving={false} onSubmit={vi.fn()} />
    );
    expect(screen.getByTestId('draw-setup-card')).toBeInTheDocument();
  });

  it('arms design_config.luckyDraw + seeded terms on submit; boost defaults to close; end_date follows the close', () => {
    const onSubmit = vi.fn();
    render(
      <CampaignDetailsTab initial={null} type="lead_generation" draw isEdit={false} saving={false} onSubmit={onSubmit} />
    );
    fillBasics();
    fireEvent.click(screen.getByRole('button', { name: /Create draft/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.type).toBe('lead_generation');
    expect(payload.design_config.luckyDraw).toEqual({
      enabled: true,
      prize: 'One (1) iPhone 17 Pro',
      closesAt: '2026-08-31',
      boostClosesAt: '2026-08-31',
      multiplier: 10,
    });
    expect(payload.design_config.termsContent).toContain('iPhone Lucky Draw');
    expect(payload.design_config.termsContent).toContain('One (1) iPhone 17 Pro');
    expect(payload.design_config.termsContent).toContain('31 August 2026');
    expect(payload.design_config.termsContent).toContain('10 entries instead of one');
    expect(payload.design_config.termsContent).toContain('never ask you to pay a fee');
    // end_date empty → aligned to the draw close
    expect(payload.end_date).toBe(new Date('2026-08-31').toISOString());
  });

  it('a distinct boost deadline and multiplier flow through', () => {
    const onSubmit = vi.fn();
    render(
      <CampaignDetailsTab initial={null} type="lead_generation" draw isEdit={false} saving={false} onSubmit={onSubmit} />
    );
    fillBasics();
    fireEvent.change(screen.getByLabelText('Session boost deadline'), { target: { value: '2026-08-15' } });
    fireEvent.change(screen.getByLabelText('Session multiplier'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: /Create draft/i }));
    const ld = onSubmit.mock.calls[0][0].design_config.luckyDraw;
    expect(ld.boostClosesAt).toBe('2026-08-15');
    expect(ld.multiplier).toBe(20);
  });

  it('refuses to submit without a prize or close date', () => {
    const onSubmit = vi.fn();
    render(
      <CampaignDetailsTab initial={null} type="lead_generation" draw isEdit={false} saving={false} onSubmit={onSubmit} />
    );
    fireEvent.change(screen.getByLabelText('Campaign name'), { target: { value: 'Draw' } });
    fireEvent.submit(screen.getByRole('button', { name: /Create draft/i }).closest('form'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('non-draw submits never carry design_config', () => {
    const onSubmit = vi.fn();
    render(
      <CampaignDetailsTab initial={null} type="lead_generation" isEdit={false} saving={false} onSubmit={onSubmit} />
    );
    fireEvent.change(screen.getByLabelText('Campaign name'), { target: { value: 'Plain' } });
    fireEvent.click(screen.getByRole('button', { name: /Create draft/i }));
    expect(onSubmit.mock.calls[0][0].design_config).toBeUndefined();
  });
});
