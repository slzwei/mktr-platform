/**
 * Canvas click-to-edit instrumentation (`data-se`) — the per-template ×
 * viewport site matrix. Two-sided by design (plan review #8): every rendered
 * `data-se` value must be a key of STUDIO_EDIT_TARGETS (an unknown path could
 * never focus a field), AND every template/viewport must expose exactly its
 * expected editable-slot set (a missing attribute is a dead click on visibly
 * editable text). Conditional-provenance sites (Nightfall sheet fallback,
 * Gazette PRIZE fallback) are pinned separately.
 *
 * Known, deliberate limitation: YouTube media renders a nested <iframe> that
 * swallows clicks — YouTube interaction wins over click-to-edit there, so the
 * fixture uses `video` media (the tagged frame div receives clicks).
 */
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn(), baseURL: 'http://localhost/api' },
}));

import CampaignPageRenderer from '../CampaignPageRenderer';
import { upgradeDesignConfig, TEMPLATE_IDS } from '@/lib/designConfigV2';
import { STUDIO_EDIT_TARGETS } from '@/components/studio/studioEditTargets';
import { editorialBaseline } from '../../../../test-fixtures/designConfigV1Docs.mjs';

const fullDoc = (templateId, contentOver = {}, drawOver = {}) => {
  const doc = upgradeDesignConfig(editorialBaseline);
  doc.template = { ...doc.template, id: templateId };
  if (templateId === 'express') {
    doc.template.params = {
      ...doc.template.params,
      express: { ...doc.template.params?.express, trustLine: 'Trusted by 12,000' },
    };
  }
  doc.content = {
    ...doc.content,
    wordmark: 'redeem.sg',
    headline: 'Win the grand prize',
    subheadline: 'One prize, one winner',
    story: 'First paragraph of the story.\n\nSecond paragraph of the story.',
    emphasis: 'Prize: something great.',
    heroCtaLabel: 'Claim yours',
    submitLabel: 'Enter now',
    media: { kind: 'video', src: 'https://cdn.example.com/clip.mp4' },
    footer: { regulatory: 'Regulatory line for tests.', brand: 'Powered by MKTR' },
    ...contentOver,
  };
  // The baseline fixture enables the SG/PR gate, which renders BEFORE the form
  // and would hide the funnel's h2/p sites — the matrix pins the resting form.
  doc.form = { ...doc.form, gates: { ...doc.form?.gates, sgPr: false } };
  // Far-future dates: a past closesAt flips the renderer to the CLOSED page
  // and would silently empty the whole open-state inventory (plan review #9).
  doc.luckyDraw = {
    enabled: true,
    prize: 'Grand Prize',
    closesAt: '2099-12-30',
    boostClosesAt: '2099-12-30',
    multiplier: 10,
    winners: 1,
    ...drawOver,
  };
  return doc;
};

const renderTemplate = (doc) =>
  render(
    <CampaignPageRenderer
      campaign={{ id: 'camp-edit', name: 'Edit Targets Campaign', is_active: true, design_config: doc }}
      previewMode
      onSubmit={() => {}}
    />
  );

/** jsdom defaults to 1024 (desktop); mobile assertions set 390. */
const setViewport = (w) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
  window.dispatchEvent(new Event('resize'));
};

const collect = (container) =>
  new Set(Array.from(container.querySelectorAll('[data-se]')).map((el) => el.getAttribute('data-se')));

afterEach(() => setViewport(1024));

// The reused funnel form contributes these on EVERY template (h2 + promo <p>).
const FORM = ['content.headline', 'content.subheadline'];
const sorted = (arr) => [...new Set(arr)].sort();

/** Expected editable-path set per template and viewport (the truth table). */
const EXPECTED = {
  editorial: {
    mobile: [...FORM, 'content.wordmark', 'content.media', 'content.story', 'content.emphasis', 'content.footer.regulatory', 'content.footer.brand'],
    desktop: [...FORM, 'content.wordmark', 'content.media', 'content.story', 'content.emphasis', 'content.footer.regulatory', 'content.footer.brand'],
  },
  poster: {
    mobile: [...FORM, 'content.wordmark', 'content.media', 'content.story', 'content.emphasis', 'content.footer.regulatory', 'content.footer.brand'],
    desktop: [...FORM, 'content.wordmark', 'content.media', 'content.story', 'content.emphasis', 'content.footer.regulatory', 'content.footer.brand'],
  },
  split: {
    mobile: [...FORM, 'content.wordmark', 'content.media', 'content.footer.regulatory', 'content.footer.brand'],
    desktop: [...FORM, 'content.wordmark', 'content.media', 'content.footer.regulatory', 'content.footer.brand'],
  },
  // Spotlight renders no media block at all.
  spotlight: {
    mobile: [...FORM, 'content.wordmark', 'content.story', 'content.emphasis', 'content.footer.regulatory', 'content.footer.brand'],
    desktop: [...FORM, 'content.wordmark', 'content.story', 'content.emphasis', 'content.footer.regulatory', 'content.footer.brand'],
  },
  // Express renders no media/story/emphasis; the trust line is its own param.
  express: {
    mobile: [...FORM, 'content.wordmark', 'template.params.express.trustLine', 'content.footer.regulatory', 'content.footer.brand'],
    desktop: [...FORM, 'content.wordmark', 'template.params.express.trustLine', 'content.footer.regulatory', 'content.footer.brand'],
  },
  journey: {
    mobile: [...FORM, 'content.wordmark', 'content.media', 'content.story', 'content.emphasis', 'content.footer.regulatory', 'content.footer.brand'],
    desktop: [...FORM, 'content.wordmark', 'content.media', 'content.story', 'content.emphasis', 'content.footer.regulatory', 'content.footer.brand'],
  },
  // Postcard renders emphasis only in the mobile below-card body.
  postcard: {
    mobile: [...FORM, 'content.wordmark', 'content.media', 'content.story', 'content.emphasis', 'content.footer.regulatory', 'content.footer.brand'],
    desktop: [...FORM, 'content.wordmark', 'content.media', 'content.story', 'content.footer.regulatory', 'content.footer.brand'],
  },
  // Gazette renders story/emphasis only in the desktop left column.
  gazette: {
    mobile: [...FORM, 'content.wordmark', 'content.media', 'content.footer.regulatory', 'content.footer.brand'],
    desktop: [...FORM, 'content.wordmark', 'content.media', 'content.story', 'content.emphasis', 'content.footer.regulatory', 'content.footer.brand'],
  },
  // Nightfall desktop has no story/footer sites; mobile has regulatory but no
  // brand line (drawTemplates.jsx renders content.regulatory directly).
  nightfall: {
    mobile: [...FORM, 'content.wordmark', 'content.media', 'content.story', 'content.emphasis', 'content.footer.regulatory'],
    desktop: [...FORM, 'content.wordmark', 'content.media', 'content.emphasis'],
  },
  // Stub renders story/emphasis only in the mobile body.
  stub: {
    mobile: [...FORM, 'content.wordmark', 'content.media', 'content.story', 'content.emphasis', 'content.footer.regulatory', 'content.footer.brand'],
    desktop: [...FORM, 'content.wordmark', 'content.media', 'content.footer.regulatory', 'content.footer.brand'],
  },
  // Checklist has no emphasis site at all; story is desktop-only.
  checklist: {
    mobile: [...FORM, 'content.wordmark', 'content.media', 'content.footer.regulatory', 'content.footer.brand'],
    desktop: [...FORM, 'content.wordmark', 'content.media', 'content.story', 'content.footer.regulatory', 'content.footer.brand'],
  },
};

describe('data-se site matrix', () => {
  it('covers every registered template (a new template must declare its row)', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...TEMPLATE_IDS].sort());
  });

  for (const [templateId, byViewport] of Object.entries(EXPECTED)) {
    for (const [viewport, expected] of Object.entries(byViewport)) {
      it(`${templateId} @ ${viewport} exposes exactly the expected editable slots`, async () => {
        setViewport(viewport === 'mobile' ? 390 : 1024);
        const { container } = renderTemplate(fullDoc(templateId));
        // Spotlight reveals its intro copy once QuizGate resolves the no-quiz
        // stage asynchronously — waitFor covers every template uniformly.
        await waitFor(() => {
          const actual = collect(container);
          for (const path of actual) {
            expect(STUDIO_EDIT_TARGETS, `unknown data-se path "${path}"`).toHaveProperty([path]);
          }
          expect([...actual].sort()).toEqual(sorted(expected));
        });
      });
    }
  }

  // Multiplicity guard (diff review #1): the set-based matrix can't see a lost
  // duplicate — the funnel h2 always supplies content.headline, so templates
  // with their OWN hero headline must show ≥2 sites.
  const TEMPLATE_OWNED_HEADLINE = ['poster', 'split', 'spotlight', 'journey', 'postcard', 'gazette', 'nightfall', 'stub', 'checklist'];
  for (const templateId of TEMPLATE_OWNED_HEADLINE) {
    it(`${templateId} keeps its template-owned headline site beside the form h2`, async () => {
      setViewport(390);
      const { container } = renderTemplate(fullDoc(templateId));
      await waitFor(() => {
        expect(container.querySelectorAll('[data-se="content.headline"]').length).toBeGreaterThanOrEqual(2);
      });
    });
  }

  it('journey keeps BOTH headline sites (hero + sticky bar) plus the form h2', async () => {
    setViewport(1024);
    const { container } = renderTemplate(fullDoc('journey'));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-se="content.headline"]').length).toBeGreaterThanOrEqual(3);
    });
  });

  it('nightfall mobile keeps BOTH emphasis sites (body + sheet header)', async () => {
    setViewport(390);
    const { container } = renderTemplate(fullDoc('nightfall'));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-se="content.emphasis"]').length).toBe(2);
    });
  });
});

describe('conditional provenance (plan review #4)', () => {
  it('nightfall sheet header retargets to the HEADLINE when emphasis is empty', async () => {
    setViewport(390);
    const { container } = renderTemplate(fullDoc('nightfall', { emphasis: '' }));
    await waitFor(() => {
      const actual = collect(container);
      expect(actual.has('content.emphasis')).toBe(false);
      // hero + form + sheet fallback
      expect(container.querySelectorAll('[data-se="content.headline"]').length).toBeGreaterThanOrEqual(3);
    });
  });

  it('stub kicker retargets to the WORDMARK when the campaign has no name', async () => {
    setViewport(390);
    const doc = fullDoc('stub');
    const { container } = render(
      <CampaignPageRenderer
        campaign={{ id: 'camp-edit', name: '', is_active: true, design_config: doc }}
        previewMode
        onSubmit={() => {}}
      />
    );
    await waitFor(() => {
      // StubHeader + the ticket-head kicker fallback
      expect(container.querySelectorAll('[data-se="content.wordmark"]').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('gazette PRIZE row is untagged with a real prize, retargets to headline without one', async () => {
    setViewport(1024);
    const withPrize = renderTemplate(fullDoc('gazette'));
    await waitFor(() => {
      expect(withPrize.container.querySelector('strong[data-se]')).toBeNull();
    });
    withPrize.unmount();
    const noPrize = renderTemplate(fullDoc('gazette', {}, { prize: '' }));
    await waitFor(() => {
      expect(noPrize.container.querySelector('strong[data-se="content.headline"]')).toBeTruthy();
    });
  });
});

describe('blocked / draw-closed states (diff review #2)', () => {
  it('the generic blocked page keeps wordmark + brand line editable', () => {
    const doc = fullDoc('editorial');
    const { container } = render(
      <CampaignPageRenderer
        campaign={{ id: 'camp-edit', name: 'N', is_active: true, design_config: doc }}
        previewMode
        jump="inactive"
        onSubmit={() => {}}
      />
    );
    expect(container.querySelector('[data-campaign-page-blocked="inactive"]')).toBeTruthy();
    expect(container.querySelector('[data-se="content.wordmark"]')).toBeTruthy();
    expect(container.querySelector('[data-se="content.footer.brand"]')).toBeTruthy();
  });

  it('the designed draw-closed page keeps wordmark + regulatory editable', () => {
    const doc = fullDoc('nightfall');
    const { container } = render(
      <CampaignPageRenderer
        campaign={{ id: 'camp-edit', name: 'N', is_active: true, design_config: doc }}
        previewMode
        jump="draw-closed"
        onSubmit={() => {}}
      />
    );
    expect(container.querySelector('[data-draw-closed="nightfall"]')).toBeTruthy();
    expect(container.querySelector('[data-se="content.wordmark"]')).toBeTruthy();
    expect(container.querySelector('[data-se="content.footer.regulatory"]')).toBeTruthy();
  });
});
