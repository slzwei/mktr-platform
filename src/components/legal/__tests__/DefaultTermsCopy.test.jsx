import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import DefaultTermsCopy from '../DefaultTermsCopy';

/**
 * Business-model guard for the default campaign T&Cs (reworked 2026-07-21).
 *
 * The superseded copy described a compensated introducer / referral-partner
 * model that MKTR does not operate, and said introducers were "not allowed"
 * to advise. These assertions pin the ACTUAL model so it cannot silently
 * regress: sponsors pay us, reward partners are independent third parties
 * (sometimes absent — the consultant then hands the reward over at the
 * session), and nobody is paid to send consumers here.
 */
describe('DefaultTermsCopy — the terms describe the real business model', () => {
  it('states that sponsors/businesses fund campaigns and that nobody is paid to refer consumers in', () => {
    render(<DefaultTermsCopy />);
    expect(screen.getByText(/How campaigns are funded/)).toBeInTheDocument();
    expect(
      screen.getByText(/no third party is compensated for referring you/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/does not engage introducers or referral agents/i)).toBeInTheDocument();
  });

  it('describes BOTH reward paths: an independent partner business, or the consultant at the session', () => {
    render(<DefaultTermsCopy />);
    expect(screen.getByText(/Who provides the reward/)).toBeInTheDocument();
    // Partner-provided: an independent third party (studio / enrichment centre / clinic).
    expect(screen.getByText(/an independent\s+third party/i)).toBeInTheDocument();
    // Consultant-provided: the no-partner case.
    expect(screen.getByText(/where a\s+campaign has no partner business/i)).toBeInTheDocument();
  });

  it('states the sponsored-campaign session requirement with no purchase obligation', () => {
    render(<DefaultTermsCopy />);
    expect(screen.getByText(/typically around 20 minutes/i)).toBeInTheDocument();
    expect(screen.getByText(/under no obligation to purchase anything/i)).toBeInTheDocument();
  });

  it('never revives the retired introducer wording', () => {
    const { container } = render(<DefaultTermsCopy />);
    const text = container.textContent;
    expect(text).not.toMatch(/introducers are not allowed/i);
    expect(text).not.toMatch(/connecting interested individuals/i);
  });

  it('marketing channels match the hashed consent clause (no broader claim)', () => {
    const { container } = render(<DefaultTermsCopy />);
    const text = container.textContent;
    expect(text).toMatch(/phone call, text message \(SMS or WhatsApp\) and email/);
    // The old copy claimed postal mail + social media, which nobody consents to.
    expect(text).not.toMatch(/postal mail/i);
  });

  it('gives the Singapore contact from the Personal Data Policy, not the retired +60 number', () => {
    const { container } = render(<DefaultTermsCopy />);
    expect(container.textContent).toContain('+65 8079 0542');
    expect(container.textContent).not.toContain('+60 11 5438 8337');
  });
});
