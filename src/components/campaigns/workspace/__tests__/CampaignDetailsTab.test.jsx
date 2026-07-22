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
    fireEvent.change(screen.getByLabelText('Prize 1 name'), { target: { value: 'iPhone 17 Pro' } });
    fireEvent.change(screen.getByLabelText('Entries close'), { target: { value: '2026-08-31' } });
  };
  const addSecondPrize = (qty, name) => {
    fireEvent.click(screen.getByTestId('add-prize-row'));
    fireEvent.change(screen.getByLabelText('Prize 2 quantity'), { target: { value: String(qty) } });
    fireEvent.change(screen.getByLabelText('Prize 2 name'), { target: { value: name } });
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

  it('arms structured prizes + seeded terms on submit; boost defaults to close; end_date follows the close', () => {
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
      prizes: [{ qty: 1, name: 'iPhone 17 Pro' }],
      prize: 'iPhone 17 Pro',
      closesAt: '2026-08-31',
      boostClosesAt: '2026-08-31',
      multiplier: 10,
    });
    expect(payload.design_config.termsContent).toContain('iPhone Lucky Draw');
    expect(payload.design_config.termsContent).toContain('iPhone 17 Pro');
    expect(payload.design_config.termsContent).toContain('One winner is drawn at random');
    expect(payload.design_config.termsContent).toContain('31 August 2026');
    expect(payload.design_config.termsContent).toContain('10 entries instead of one');
    expect(payload.design_config.termsContent).toContain('never ask you to pay a fee');
    // end_date empty → aligned to the draw close
    expect(payload.end_date).toBe(new Date('2026-08-31').toISOString());
  });

  it('multiple prize rows arm ordered prizes, a derived summary, and N-winner terms', () => {
    const onSubmit = vi.fn();
    render(
      <CampaignDetailsTab initial={null} type="lead_generation" draw isEdit={false} saving={false} onSubmit={onSubmit} />
    );
    fillBasics();
    addSecondPrize(3, '$100 FairPrice Voucher');
    expect(screen.getByTestId('multi-prize-note')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Create draft/i }));
    const dc = onSubmit.mock.calls[0][0].design_config;
    expect(dc.luckyDraw.prizes).toEqual([
      { qty: 1, name: 'iPhone 17 Pro' },
      { qty: 3, name: '$100 FairPrice Voucher' },
    ]);
    expect(dc.luckyDraw.prize).toBe('iPhone 17 Pro + 3× $100 FairPrice Voucher');
    expect(dc.termsContent).toContain('One (1) &times; iPhone 17 Pro');
    expect(dc.termsContent).toContain('Three (3) &times; $100 FairPrice Voucher');
    expect(dc.termsContent).toContain('Four (4) winners are drawn at random');
    expect(dc.termsContent).toContain('Each verified mobile number can win at most one prize');
  });

  it('empty extra rows are dropped and out-of-range quantities clamp on blur', () => {
    const onSubmit = vi.fn();
    render(
      <CampaignDetailsTab initial={null} type="lead_generation" draw isEdit={false} saving={false} onSubmit={onSubmit} />
    );
    fillBasics();
    fireEvent.click(screen.getByTestId('add-prize-row')); // row 2 left empty
    fireEvent.click(screen.getByTestId('add-prize-row'));
    fireEvent.change(screen.getByLabelText('Prize 3 quantity'), { target: { value: '150' } });
    fireEvent.blur(screen.getByLabelText('Prize 3 quantity'));
    expect(screen.getByLabelText('Prize 3 quantity').value).toBe('99');
    fireEvent.change(screen.getByLabelText('Prize 3 name'), { target: { value: 'Voucher' } });
    fireEvent.click(screen.getByRole('button', { name: /Create draft/i }));
    expect(onSubmit.mock.calls[0][0].design_config.luckyDraw.prizes).toEqual([
      { qty: 1, name: 'iPhone 17 Pro' },
      { qty: 99, name: 'Voucher' },
    ]);
  });

  it('remove buttons drop a row; the cap stops at 8 rows', () => {
    render(
      <CampaignDetailsTab initial={null} type="lead_generation" draw isEdit={false} saving={false} onSubmit={vi.fn()} />
    );
    for (let i = 0; i < 10; i += 1) {
      const btn = screen.queryByTestId('add-prize-row');
      if (btn) fireEvent.click(btn);
    }
    expect(screen.getAllByTestId('draw-prize-row')).toHaveLength(8);
    fireEvent.click(screen.getByLabelText('Remove prize 8'));
    expect(screen.getAllByTestId('draw-prize-row')).toHaveLength(7);
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

  it('refuses to submit without a named prize row or close date', () => {
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
