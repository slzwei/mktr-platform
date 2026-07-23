/**
 * Canvas click-to-edit — the Studio side of the contract:
 *  - CanvasPageSubject's capture handler (fires on known [data-se] leaves,
 *    suppressed nothing else, containment + unknown-path guards);
 *  - preview interactivity survives the wrapper (hero CTA, Nightfall sheet);
 *  - the brand-link exception (edit wins over navigation, by design);
 *  - the REAL cross-root path (DeviceFrame iframe → parent callback);
 *  - useEditTargetFocus choreography (section switch, focus, caret, and the
 *    token cancellation for rapid re-clicks / unmount — plan review #7);
 *  - every STUDIO_EDIT_TARGETS entry resolves to a rendered PagePanel field.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn(), get: vi.fn(), baseURL: 'http://localhost/api' } }));
vi.mock('@/api/entities', () => ({ Campaign: { update: vi.fn() } }));
vi.mock('@/api/integrations', () => ({ UploadFile: vi.fn() }));

import CanvasPageSubject from '../CanvasPageSubject';
import StudioCanvas from '../StudioCanvas';
import PagePanel from '../panels/PagePanel';
import { STUDIO_SECTIONS } from '../StudioRail';
import { STUDIO_EDIT_TARGETS, useEditTargetFocus } from '../studioEditTargets';
import { upgradeDesignConfig } from '@/lib/designConfigV2';

const CAMPAIGN = { id: 'c1', name: 'FairPrice Voucher', status: 'active', is_active: true };

const docFor = (templateId = 'editorial') => {
  const doc = upgradeDesignConfig({ formHeadline: 'Get your voucher', customerHost: 'redeem' });
  doc.template = { ...doc.template, id: templateId };
  doc.content = {
    ...doc.content,
    wordmark: 'redeem.sg',
    headline: 'Get your voucher',
    subheadline: 'A promo line',
    story: 'One paragraph of story.',
    emphasis: 'Emphasis line.',
    heroCtaLabel: 'Claim yours',
    submitLabel: 'Enter now',
    media: { kind: 'video', src: 'https://cdn.example.com/clip.mp4' },
    footer: { regulatory: 'Reg copy.', brand: 'Powered by MKTR' },
  };
  return doc;
};

const renderSubject = (onEditTarget, doc = docFor()) =>
  render(
    <MemoryRouter>
      <CanvasPageSubject campaign={CAMPAIGN} doc={doc} jump={null} onEditTarget={onEditTarget} />
    </MemoryRouter>
  );

const setViewport = (w) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
  window.dispatchEvent(new Event('resize'));
};

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => setViewport(1024));

describe('CanvasPageSubject click capture', () => {
  it('click on an instrumented leaf fires the callback once and suppresses the event', () => {
    const cb = vi.fn();
    const { container } = renderSubject(cb);
    const emphasis = container.querySelector('[data-se="content.emphasis"]');
    const notCancelled = fireEvent.click(emphasis);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('content.emphasis');
    expect(notCancelled).toBe(false); // preventDefault ran
  });

  it('clicks inside the funnel (no data-se ancestor) pass through untouched', () => {
    const cb = vi.fn();
    const { container } = renderSubject(cb);
    const input = container.querySelector('form input');
    expect(input).toBeTruthy();
    const notCancelled = fireEvent.click(input);
    expect(cb).not.toHaveBeenCalled();
    expect(notCancelled).toBe(true);
  });

  it('unknown data-se paths are neither suppressed nor forwarded', () => {
    const cb = vi.fn();
    const { container } = renderSubject(cb);
    const scope = container.querySelector('[data-studio-edit-scope]');
    const rogue = document.createElement('div');
    rogue.setAttribute('data-se', 'bogus.path');
    rogue.textContent = 'rogue';
    scope.appendChild(rogue);
    const notCancelled = fireEvent.click(rogue);
    expect(cb).not.toHaveBeenCalled();
    expect(notCancelled).toBe(true);
  });

  it('prototype-chain paths ("constructor") fail the own-property guard', () => {
    const cb = vi.fn();
    const { container } = renderSubject(cb);
    const scope = container.querySelector('[data-studio-edit-scope]');
    const rogue = document.createElement('div');
    rogue.setAttribute('data-se', 'constructor');
    rogue.textContent = 'rogue';
    scope.appendChild(rogue);
    const notCancelled = fireEvent.click(rogue);
    expect(cb).not.toHaveBeenCalled();
    expect(notCancelled).toBe(true);
  });

  it('without onEditTarget there is no scope wrapper and no hover CSS', () => {
    const { container } = render(
      <MemoryRouter>
        <CanvasPageSubject campaign={CAMPAIGN} doc={docFor()} jump={null} />
      </MemoryRouter>
    );
    expect(container.querySelector('[data-studio-edit-scope]')).toBeNull();
  });

  it('brand-link exception: the MKTR anchor edits the brand line instead of navigating', () => {
    const cb = vi.fn();
    const { container } = renderSubject(cb);
    const link = container.querySelector('[data-se="content.footer.brand"] a');
    expect(link).toBeTruthy();
    const notCancelled = fireEvent.click(link);
    expect(cb).toHaveBeenCalledWith('content.footer.brand');
    expect(notCancelled).toBe(false);
  });
});

describe('preview interactivity survives the wrapper', () => {
  it('editorial hero CTA still scrolls to the form (not intercepted)', () => {
    const cb = vi.fn();
    renderSubject(cb);
    fireEvent.click(screen.getByRole('button', { name: 'Claim yours ↓' }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
  });

  it('nightfall mobile CTA still opens the entry sheet (not intercepted)', async () => {
    setViewport(390);
    const cb = vi.fn();
    renderSubject(cb, docFor('nightfall'));
    // The sheet (and its close button) is hidden until the CTA opens it.
    expect(screen.queryByRole('button', { name: 'Close entry form' })).toBeNull();
    const cta = await screen.findByRole('button', { name: 'Enter now' });
    fireEvent.click(cta);
    expect(await screen.findByRole('button', { name: 'Close entry form' })).toBeTruthy();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('success jump on draw campaigns', () => {
  const drawDoc = (templateId) => {
    const doc = docFor(templateId);
    doc.luckyDraw = { enabled: true, prize: 'P', closesAt: '2099-12-30', boostClosesAt: '2099-12-30', multiplier: 10, winners: 1 };
    return doc;
  };

  it('renders the DESIGNED draw success page (LeadCapture branch mirror), clickable', () => {
    const cb = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <CanvasPageSubject campaign={CAMPAIGN} doc={drawDoc('nightfall')} jump="success" onEditTarget={cb} />
      </MemoryRouter>
    );
    // The designed page, not the generic harness outcome card
    expect(container.querySelector('[data-studio-outcome]')).toBeNull();
    expect(screen.getByText(/ENTRY VERIFIED|Entry confirmed/i)).toBeInTheDocument();
    // Production parity: share sheet OPEN + the fixture phone masked into copy
    expect(screen.getByRole('dialog', { name: 'Share campaign' })).toBeInTheDocument();
    expect(container.textContent).toContain('9••• 4312');
    const scam = container.querySelector('[data-se="content.drawCopy.scamLine"]');
    expect(scam).toBeTruthy();
    fireEvent.click(scam);
    expect(cb).toHaveBeenCalledWith('content.drawCopy.scamLine');
  });

  it('non-draw success keeps the generic harness outcome', () => {
    const { container } = render(
      <MemoryRouter>
        <CanvasPageSubject campaign={CAMPAIGN} doc={docFor('editorial')} jump="success" onEditTarget={vi.fn()} />
      </MemoryRouter>
    );
    expect(container.querySelector('[data-studio-outcome="success"]')).toBeTruthy();
  });
});

describe('cross-root path (DeviceFrame iframe → parent callback)', () => {
  it('a click inside the frame document reaches onEditTarget, and the hint line shows', async () => {
    const cb = vi.fn();
    const { container } = render(
      <StudioCanvas campaign={CAMPAIGN} doc={docFor()} onEditTarget={cb} />
    );
    expect(screen.getByText(/click text to edit it/)).toBeInTheDocument();
    let frameDoc;
    await waitFor(() => {
      frameDoc = container.querySelector('iframe')?.contentDocument;
      expect(frameDoc?.querySelector('[data-campaign-page-ready="true"]')).toBeTruthy();
    });
    expect(frameDoc.querySelector('[data-studio-edit-scope]')).toBeTruthy();
    const wordmark = frameDoc.querySelector('[data-se="content.wordmark"]');
    expect(wordmark).toBeTruthy();
    fireEvent.click(wordmark);
    expect(cb).toHaveBeenCalledWith('content.wordmark');
  });
});

describe('useEditTargetFocus choreography', () => {
  let rafQueue;
  let headline;
  let story;
  const flushRaf = () => {
    while (rafQueue.length) rafQueue.shift()();
  };

  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    headline = document.createElement('input');
    headline.id = 'studio-headline';
    story = document.createElement('textarea');
    story.id = 'studio-story';
    story.value = 'existing story';
    document.body.append(headline, story);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    headline.remove();
    story.remove();
  });

  it('switches the section, then focuses the field with the caret at the end', () => {
    const setSection = vi.fn();
    const { result } = renderHook(() => useEditTargetFocus(setSection));
    act(() => result.current('content.story'));
    expect(setSection).toHaveBeenCalledWith('page');
    act(flushRaf);
    expect(document.activeElement).toBe(story);
    expect(story.selectionStart).toBe(story.value.length);
  });

  it('a rapid second jump cancels the first (no stale focus steal)', () => {
    const setSection = vi.fn();
    const { result } = renderHook(() => useEditTargetFocus(setSection));
    act(() => {
      result.current('content.headline');
      result.current('content.story');
    });
    act(flushRaf);
    expect(document.activeElement).toBe(story);
  });

  it('unmount cancels pending choreography', () => {
    const setSection = vi.fn();
    const { result, unmount } = renderHook(() => useEditTargetFocus(setSection));
    act(() => result.current('content.headline'));
    unmount();
    act(flushRaf);
    expect(document.activeElement).not.toBe(headline);
  });

  it('unknown paths are ignored entirely', () => {
    const setSection = vi.fn();
    const { result } = renderHook(() => useEditTargetFocus(setSection));
    act(() => result.current('bogus.path'));
    act(() => result.current('constructor')); // prototype-chain key, same guard
    expect(setSection).not.toHaveBeenCalled();
    expect(rafQueue).toHaveLength(0);
  });
});

describe('map ↔ PagePanel contract', () => {
  it('every edit target resolves to a rendered element in its section panel', () => {
    // Express so the trust-line param field renders; every other target is
    // unconditional in PagePanel. Every current target lives in the Page
    // panel — a target declaring another section MUST extend this test with
    // that section's panel harness (diff review #4).
    const doc = docFor('express');
    doc.luckyDraw = { enabled: true, prize: 'P', closesAt: '2099-12-30', boostClosesAt: '2099-12-30', multiplier: 10, winners: 1 };
    const { container } = render(
      <PagePanel doc={doc} setPath={vi.fn()} mut={vi.fn()} />
    );
    for (const [path, target] of Object.entries(STUDIO_EDIT_TARGETS)) {
      expect(STUDIO_SECTIONS.map(([id]) => id)).toContain(target.section);
      expect(target.section, `no panel harness for section "${target.section}" (${path})`).toBe('page');
      expect(container.querySelector(`#${target.id}`), `missing #${target.id} for ${path}`).toBeTruthy();
    }
  });
});
