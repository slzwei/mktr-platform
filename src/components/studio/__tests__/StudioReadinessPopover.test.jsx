import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StudioReadinessPopover from '../StudioReadinessPopover';

/**
 * PR 5: server DELIVERY items with a section mapping deep-link into the rail
 * exactly like design items; unmapped items stay inert.
 */

const items = [
  { source: 'delivery', sev: 'block', sec: 'form', code: 'otp_send_unconfigured', msg: 'SMS OTP cannot be sent.' },
  { source: 'delivery', sev: 'warn', sec: null, code: 'draw_record_missing', msg: 'No draw record exists.' },
  { source: 'design', sev: 'warn', sec: 'theme', msg: 'Accent is hard to see.' },
];

describe('StudioReadinessPopover', () => {
  it('a mapped delivery item is a deep-link button; an unmapped one is inert', () => {
    const onGoSection = vi.fn();
    const onClose = vi.fn();
    render(<StudioReadinessPopover open items={items} onGoSection={onGoSection} onClose={onClose} />);

    fireEvent.click(screen.getByText('SMS OTP cannot be sent.'));
    expect(onGoSection).toHaveBeenCalledWith('form');
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('No draw record exists.'));
    expect(onGoSection).toHaveBeenCalledTimes(1); // unchanged — inert row
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Accent is hard to see.'));
    expect(onGoSection).toHaveBeenCalledWith('theme');
  });

  it('keeps the DELIVERY/DESIGN group headers', () => {
    render(<StudioReadinessPopover open items={items} onGoSection={() => {}} onClose={() => {}} />);
    expect(screen.getByText('DELIVERY (SERVER)')).toBeInTheDocument();
    expect(screen.getByText('DESIGN (THIS DOCUMENT)')).toBeInTheDocument();
  });
});
