/**
 * GROUND TRUTH for the Studio's hero-media guidance (`src/lib/heroMediaSpecs.js`).
 *
 * The spec table tells operators which templates render their upload and which
 * do not. Those claims are only trustworthy if they are checked against the
 * REAL renderers — a test that asserts the spec's own copy proves nothing. So
 * this file mounts CampaignPageRenderer with an actual image hero on every
 * template and asks the DOM whether the <img> made it to the page, then
 * requires the spec table to agree.
 *
 * If a future template starts (or stops) rendering hero media and the spec is
 * not updated with it, this fails — which is the whole point.
 */
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn(), baseURL: 'http://localhost/api' },
}));

import CampaignPageRenderer from '../CampaignPageRenderer';
import { upgradeDesignConfig, TEMPLATE_IDS } from '@/lib/designConfigV2';
import { heroMediaSpec, heroMediaHiddenReason } from '@/lib/heroMediaSpecs';
import { editorialBaseline } from '../../../../test-fixtures/designConfigV1Docs.mjs';

const HERO = '/uploads/ground-truth-hero.jpg';

/** Templates branch hard on `mobile` (CampaignPageRenderer's useIsMobile reads
 *  window.innerWidth against a 640px breakpoint) and several call MediaBlock
 *  from a DIFFERENT place in each branch — so both have to be checked. */
const VIEWPORTS = { desktop: 1440, mobile: 390 };
const setViewport = (width) => {
  window.innerWidth = width;
};

function mountTemplate(templateId, params = {}) {
  const doc = upgradeDesignConfig({ ...editorialBaseline, imageUrl: HERO, mediaType: 'image' });
  doc.template = { ...doc.template, id: templateId };
  doc.content.media = { ...doc.content.media, kind: 'image', src: HERO };
  if (Object.keys(params).length) {
    doc.template.params = {
      ...doc.template.params,
      [templateId]: { ...doc.template.params[templateId], ...params },
    };
  }
  const campaign = { id: 'camp-1', name: 'Test Campaign', design_config: doc };
  const { container } = render(<CampaignPageRenderer campaign={campaign} previewMode onSubmit={vi.fn()} />);
  return container;
}

/** The real question: did MediaBlock put the upload on the page? */
const rendersHero = (container) => !!container.querySelector(`img[src*="ground-truth-hero"]`);

afterEach(() => {
  cleanup();
  setViewport(VIEWPORTS.desktop);
});

describe('hero media — spec table vs the actual renderers', () => {
  for (const [label, width] of Object.entries(VIEWPORTS)) {
    it.each(TEMPLATE_IDS)(`%s (${label}): the spec agrees with what the page renders`, (templateId) => {
      setViewport(width);
      const shown = rendersHero(mountTemplate(templateId));
      const claimedHidden = !!heroMediaSpec(templateId).hidden;
      expect(shown).toBe(!claimedHidden);
    });
  }

  it('spotlight and express drop the upload on BOTH breakpoints', () => {
    for (const width of Object.values(VIEWPORTS)) {
      for (const templateId of ['spotlight', 'express']) {
        setViewport(width);
        expect(rendersHero(mountTemplate(templateId))).toBe(false);
        cleanup();
      }
    }
  });

  it('stub: the Accent ticket header really hides the image (and Photo really shows it)', () => {
    expect(rendersHero(mountTemplate('stub', { ticketTone: 'paper' }))).toBe(true);
    cleanup();
    expect(rendersHero(mountTemplate('stub', { ticketTone: 'accent' }))).toBe(false);
    // …and the panel says so for exactly that param value.
    expect(heroMediaHiddenReason('stub', { ticketTone: 'accent' })).toBeTruthy();
    expect(heroMediaHiddenReason('stub', { ticketTone: 'paper' })).toBeNull();
  });

  it('checklist: heroBand=false really hides the band (and on by default shows it)', () => {
    expect(rendersHero(mountTemplate('checklist', {}))).toBe(true);
    cleanup();
    expect(rendersHero(mountTemplate('checklist', { heroBand: false }))).toBe(false);
    expect(heroMediaHiddenReason('checklist', { heroBand: false })).toBeTruthy();
    expect(heroMediaHiddenReason('checklist', {})).toBeNull();
  });

  it('no OTHER template param silently hides the media the way stub/checklist do', () => {
    // Every param value in the clamp's enums, for templates the spec calls
    // visible. Anything that hides the image must be reported by
    // heroMediaHiddenReason — otherwise the panel promises a size for nothing.
    const cases = [
      ['poster', { overlay: 'plain' }], ['poster', { formReveal: 'modal' }],
      ['split', { mediaSide: 'right' }], ['split', { mediaFit: 'contain' }],
      ['postcard', { cardStyle: 'flush' }], ['postcard', { mediaSide: 'right' }],
      ['gazette', { ruleDensity: 'dense' }], ['gazette', { accentUse: 'text' }],
      ['nightfall', { overlayTone: 'dusk' }], ['nightfall', { showCountdown: false }],
      ['stub', { stubEdge: 'top' }], ['stub', { showSerial: false }],
      ['checklist', { boostStep: 'footnote' }], ['checklist', { railStyle: 'dots' }],
    ];
    for (const [templateId, params] of cases) {
      const shown = rendersHero(mountTemplate(templateId, params));
      const reported = heroMediaHiddenReason(templateId, params);
      expect({ templateId, params, shown, reported: !!reported })
        .toEqual({ templateId, params, shown: !reported, reported: !!reported });
      cleanup();
    }
  });
});
