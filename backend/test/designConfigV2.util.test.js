/**
 * design_config v2 server policy — the write gate, the hybrid-alias scrub,
 * clampDesignConfigV2 (limits/enums/policies at v2 paths, role × stored-version
 * matrix), cross-version accessors, and the campaignService guards
 * (update-path version conflict, duplicate never-clone at v2 paths,
 * ensureDrawTermsVersion v2 terms).
 */
import { jest } from '@jest/globals';
import './setup.js';
import { Op } from 'sequelize';

jest.unstable_mockModule('../src/models/index.js', () => ({
  Campaign: { create: jest.fn(), findOne: jest.fn(), findByPk: jest.fn() },
  QrTag: {}, Prospect: {}, Commission: {}, Device: {},
  CampaignMediaItem: { findAll: jest.fn(async () => []), bulkCreate: jest.fn(async () => []) },
  CampaignAgentAssignment: { findAll: jest.fn(async () => []), bulkCreate: jest.fn(async () => []) },
  sequelize: { transaction: jest.fn() },
  DrawTermsVersion: {
    findOne: jest.fn(async () => null),
    max: jest.fn(async () => null),
    create: jest.fn(async (fields) => ({ id: 'dtv-1', ...fields })),
  },
  // PR 5: ensureDrawTermsVersion consults Draw for the closesAt lock.
  Draw: { findOne: jest.fn(async () => null) },
  Op,
}));
jest.unstable_mockModule('../src/middleware/tenant.js', () => ({ getTenantId: jest.fn() }));
jest.unstable_mockModule('../src/services/storage.js', () => ({ storageService: {} }));
jest.unstable_mockModule('../src/services/pushService.js', () => ({ pushService: { sendEvent: jest.fn() } }));
jest.unstable_mockModule('../src/services/walletService.js', () => ({
  refundCampaignCommitments: jest.fn(async () => ({ refunded: 0, totalCents: 0 })),
}));

const models = await import('../src/models/index.js');
const { clampDesignConfig, updateCampaign, duplicateCampaign, ensureDrawTermsVersion } =
  await import('../src/services/campaignService.js');
const {
  clampDesignConfigV2,
  getStoredFeaturedDrop,
  getStoredMarketplaceListed,
  getStoredTermsHtml,
  getStoredHostChoice,
} = await import('../src/utils/designConfigV2Clamp.js');
const { upgradeDesignConfig } = await import('../src/utils/designConfigV2.js');
const { V1_DOCS, TAGGED_DOCS, adminRichDoc, editorialBaseline } =
  await import('../../test-fixtures/designConfigV1Docs.mjs');

const flagOn = () => { process.env.DESIGN_CONFIG_V2_WRITES_ENABLED = 'true'; };
const flagOff = () => { delete process.env.DESIGN_CONFIG_V2_WRITES_ENABLED; };
afterEach(() => { flagOff(); jest.clearAllMocks(); });

const v2Editorial = upgradeDesignConfig(editorialBaseline);
const v2Rich = upgradeDesignConfig(adminRichDoc);

describe('write gate (default OFF — the PR ships dark)', () => {
  it.each(Object.entries(TAGGED_DOCS))(
    'rejects version-tagged payload "%s" with a typed 422 while the flag is off',
    (_name, doc) => {
      expect.assertions(3);
      try {
        clampDesignConfig(doc, undefined, 'admin');
      } catch (err) {
        expect(err.statusCode).toBe(422);
        expect(err.data).toEqual({ code: 'DESIGN_CONFIG_VERSION_UNSUPPORTED' });
        expect(err.isOperational).toBe(true);
      }
    }
  );

  it('still rejects NON-v2 versions (3, "2") even with the flag on', () => {
    flagOn();
    for (const doc of [TAGGED_DOCS.futureVersion, TAGGED_DOCS.stringVersion]) {
      expect(() => clampDesignConfig(doc, undefined, 'admin')).toThrow(
        expect.objectContaining({ statusCode: 422 })
      );
    }
  });

  it('accepts a v2 document when the flag is on', () => {
    flagOn();
    const out = clampDesignConfig(v2Editorial, undefined, 'admin');
    expect(out.version).toBe(2);
    expect(out.content.headline).toBe('Get your $10 voucher');
  });

  it('leaves every untagged (v1) fixture on the untouched v1 path, flag on or off', () => {
    for (const doc of Object.values(V1_DOCS)) {
      const off = clampDesignConfig(structuredClone(doc), undefined, 'admin');
      flagOn();
      const on = clampDesignConfig(structuredClone(doc), undefined, 'admin');
      flagOff();
      expect(on).toEqual(off);
      expect(on.version).toBeUndefined();
    }
  });
});

describe('hybrid-alias scrub (authorization bypass)', () => {
  it('strips smuggled top-level v1 publication keys for EVERY role', () => {
    for (const role of ['admin', 'agent', undefined]) {
      const out = clampDesignConfigV2(TAGGED_DOCS.hybridAliasSmuggle, undefined, role);
      expect(out.featuredDrop).toBeUndefined();
      expect(out.marketplaceListed).toBeUndefined();
      // …and nothing landed at the policied v2 paths either (none was sent there).
      expect(out.distribution.featuredDrop).toBeUndefined();
      expect(out.distribution.marketplace?.listed).toBeUndefined();
    }
  });

  it('strips every other known v1 alias while keeping unknown future keys', () => {
    const out = clampDesignConfigV2(
      { ...v2Editorial, formHeadline: 'smuggled', themeColor: '#000000', futureKey: { ok: 1 } },
      undefined,
      'admin'
    );
    expect(out.formHeadline).toBeUndefined();
    expect(out.themeColor).toBeUndefined();
    expect(out.futureKey).toEqual({ ok: 1 });
  });
});

describe('clampDesignConfigV2 — limits, enums, derived mirror', () => {
  it('clamps content lengths and template ranges; invalid enums fall back', () => {
    const noisy = {
      version: 2,
      template: { id: 'hologram', params: { editorial: { formWidth: 250 }, express: { trustLine: 'x'.repeat(200) } } },
      theme: { preset: 'neon', accent: 'D17029', font: 'comic-sans', radius: 'blobby', background: 'lava' },
      content: { headline: 'H'.repeat(200), media: { kind: 'video', src: 'https://youtu.be/dQw4w9WgXcQ', alt: 'a'.repeat(300) } },
      form: { verification: 'carrier-pigeon', fields: 'not-an-array', gates: { sgPr: 'yes' } },
      distribution: { host: 'evil.example' },
    };
    const out = clampDesignConfigV2(noisy, undefined, 'admin');
    expect(out.template.id).toBe('editorial');
    expect(out.template.params.editorial.formWidth).toBe(300);
    expect(out.template.params.express.trustLine).toHaveLength(80);
    expect(out.theme.preset).toBe('warm-cream'); // redeem-host default
    expect(out.theme.accent).toBe('#D17029'); // 6-hex accepted with or without #
    expect(out.theme.font).toBeUndefined();
    expect(out.content.headline).toHaveLength(80);
    expect(out.content.media.kind).toBe('youtube'); // honest reclassification
    expect(out.content.media.alt).toHaveLength(120);
    expect(out.form.verification).toBe('sms');
    expect(out.form.gates.sgPr).toBe(false); // strict boolean
    expect(out.form.fields.map((f) => f.id)).toEqual(['name', 'email', 'phone', 'dob', 'postal', 'education', 'salary']);
    expect(out.distribution.host).toBe('redeem');
    expect(out.customerHost).toBe('redeem');
  });

  it('host conflict: canonical distribution.host wins; the mirror is always derived', () => {
    const out = clampDesignConfigV2(
      { version: 2, distribution: { host: 'mktr' }, customerHost: 'redeem' },
      undefined,
      'admin'
    );
    expect(out.distribution.host).toBe('mktr');
    expect(out.customerHost).toBe('mktr');
  });

  it('mktr host defaults the theme preset host-aware', () => {
    const out = clampDesignConfigV2({ version: 2, distribution: { host: 'mktr' } }, undefined, 'admin');
    expect(out.theme.preset).toBe('paper-white');
  });

  it('locked fields are forced visible+required; dupes collapse; missing append', () => {
    const out = clampDesignConfigV2(
      {
        version: 2,
        form: { fields: [
          { id: 'email', visible: false, required: false, row: null },
          { id: 'email', visible: true, required: true, row: null },
          { id: 'salary', visible: true, required: 'yes', row: 'r9' },
        ] },
      },
      undefined,
      'admin'
    );
    const byId = Object.fromEntries(out.form.fields.map((f) => [f.id, f]));
    expect(byId.email).toEqual({ id: 'email', visible: true, required: true, row: null });
    expect(byId.salary).toEqual({ id: 'salary', visible: true, required: false, row: 'r9' });
    expect(out.form.fields).toHaveLength(7);
  });
});

describe('role × stored-version policy matrix (publication state)', () => {
  const incomingDrop = { enabled: true, title: 'New drop', valueLabel: 'S$5', emoji: '🎁' };
  const v2Incoming = {
    version: 2,
    distribution: { host: 'redeem', featuredDrop: incomingDrop, marketplace: { listed: true, title: 'L' } },
  };

  it('admin incoming wins over stored v1 AND stored v2', () => {
    for (const stored of [adminRichDoc, v2Rich]) {
      const out = clampDesignConfigV2(v2Incoming, stored, 'admin');
      expect(out.distribution.featuredDrop).toMatchObject({ enabled: true, title: 'New drop' });
      expect(out.distribution.marketplace.listed).toBe(true);
    }
  });

  it('non-admin transition save (stored v1) PRESERVES the v1 publication state', () => {
    const out = clampDesignConfigV2(v2Incoming, adminRichDoc, 'agent');
    expect(out.distribution.featuredDrop).toMatchObject({
      enabled: true, title: 'Tokyo Getaway Lucky Draw', valueLabel: 'S$3.8k',
    });
    expect(out.distribution.marketplace.listed).toBe(true); // stored value, not the agent's
    expect(out.luckyDraw).toMatchObject({ enabled: true, prize: adminRichDoc.luckyDraw.prize });
  });

  it('non-admin save over stored v2 preserves the v2-path stored state', () => {
    const out = clampDesignConfigV2(
      { version: 2, distribution: { host: 'redeem', featuredDrop: { enabled: false } } },
      v2Rich,
      'agent'
    );
    expect(out.distribution.featuredDrop).toEqual(getStoredFeaturedDrop(v2Rich));
  });

  it('non-admin cannot seed publication state when none is stored', () => {
    const out = clampDesignConfigV2(v2Incoming, undefined, 'agent');
    expect(out.distribution.featuredDrop).toBeUndefined();
    expect(out.distribution.marketplace?.listed).toBeUndefined();
  });
});

describe('cross-version stored-state accessors', () => {
  it('read from the right path per version', () => {
    expect(getStoredFeaturedDrop(adminRichDoc)).toEqual(adminRichDoc.featuredDrop);
    expect(getStoredFeaturedDrop(v2Rich)).toEqual(v2Rich.distribution.featuredDrop);
    expect(getStoredMarketplaceListed(adminRichDoc)).toBe(true);
    expect(getStoredMarketplaceListed(v2Rich)).toBe(true);
    expect(getStoredTermsHtml(adminRichDoc)).toBe(adminRichDoc.termsContent);
    expect(getStoredTermsHtml(v2Rich)).toBe(adminRichDoc.termsContent);
    expect(getStoredHostChoice(adminRichDoc)).toBe('redeem');
    expect(getStoredHostChoice(v2Rich)).toBe('redeem');
    expect(getStoredTermsHtml(null)).toBe('');
  });
});

describe('campaignService guards', () => {
  it('updateCampaign rejects an untagged save over a stored v2 doc (409 + typed code)', async () => {
    models.Campaign.findOne.mockResolvedValue({
      id: 'c1',
      design_config: v2Editorial,
      slug: null,
      firstActivatedAt: null,
      update: jest.fn(),
    });
    await expect(
      updateCampaign('c1', { design_config: { formHeadline: 'old editor save' } }, { user: { id: 'u1', role: 'admin' } })
    ).rejects.toMatchObject({ statusCode: 409, data: { code: 'DESIGN_CONFIG_VERSION_CONFLICT' } });
  });

  it('PR 5 rollback: admin + confirmDesignRollback restores a v1 snapshot over stored v2 (normal clamp path)', async () => {
    const update = jest.fn(async () => {});
    models.Campaign.findOne.mockResolvedValue({
      id: 'c1',
      design_config: v2Editorial,
      slug: null,
      firstActivatedAt: null,
      update,
      toJSON: () => ({ id: 'c1' }), // post-update DTO composition runs
    });
    await updateCampaign(
      'c1',
      { design_config: { formHeadline: 'restored v1 snapshot' }, confirmDesignRollback: true },
      { user: { id: 'u1', role: 'admin' } }
    );
    const saved = update.mock.calls[0][0].design_config;
    expect(saved.version).toBeUndefined(); // stored back as a clamped v1 doc
    expect(saved.formHeadline).toBe('restored v1 snapshot');
  });

  it('PR 5 rollback: the flag does NOTHING for a non-admin (409 stands)', async () => {
    models.Campaign.findOne.mockResolvedValue({
      id: 'c1',
      design_config: v2Editorial,
      slug: null,
      firstActivatedAt: null,
      update: jest.fn(),
    });
    await expect(
      updateCampaign(
        'c1',
        { design_config: { formHeadline: 'x' }, confirmDesignRollback: true },
        { user: { id: 'u1', role: 'agent' } }
      )
    ).rejects.toMatchObject({ statusCode: 409, data: { code: 'DESIGN_CONFIG_VERSION_CONFLICT' } });
  });

  it('duplicateCampaign strips v2 publication state at the v2 paths (flag on)', async () => {
    flagOn(); // a versioned duplicate is only allowed to persist while the gate is open
    const original = {
      toJSON: () => ({
        id: 'c2', name: 'Rich', status: 'active', design_config: structuredClone(v2Rich),
        slug: 'rich', firstActivatedAt: new Date(), leadPriceCents: 500,
      }),
    };
    models.Campaign.findOne.mockResolvedValue(original);
    models.Campaign.create.mockImplementation(async (data) => {
      const row = { id: 'c3', ...data };
      row.toJSON = () => ({ ...row });
      return row;
    });
    await duplicateCampaign('c2', {}, { user: { id: 'u1', role: 'admin' } });
    const created = models.Campaign.create.mock.calls[0][0];
    expect(created.design_config.luckyDraw).toBeUndefined();
    expect(created.design_config.distribution.featuredDrop.enabled).toBe(false);
    expect(created.design_config.distribution.marketplace.listed).toBeUndefined();
    expect(created.design_config.version).toBe(2);
    expect(created.slug).toBeNull();
  });

  it('duplicateCampaign of a v2 campaign is REJECTED while the flag is off (no ungated v2 mint)', async () => {
    // Regression: duplicate must not be a back door around the write gate.
    // A v2 doc can outlive a flag-on window (rollout then rollback); cloning it
    // while the flag is off would propagate v2 rows the cleanup can't freeze,
    // and the renderer dispatch (version-driven) would serve them immediately.
    const original = {
      toJSON: () => ({
        id: 'c2', name: 'Rich', status: 'active', design_config: structuredClone(v2Rich),
        slug: 'rich', firstActivatedAt: new Date(),
      }),
    };
    models.Campaign.findOne.mockResolvedValue(original);
    models.Campaign.create.mockResolvedValue({ id: 'c3', toJSON: () => ({ id: 'c3' }) });
    await expect(
      duplicateCampaign('c2', {}, { user: { id: 'u1', role: 'agent' } })
    ).rejects.toMatchObject({ statusCode: 422, data: { code: 'DESIGN_CONFIG_VERSION_UNSUPPORTED' } });
    expect(models.Campaign.create).not.toHaveBeenCalled();
  });

  it('duplicateCampaign of a legacy (v1) campaign is never gated (flag off)', async () => {
    // The fix is surgical: only versioned duplicates hit the gate. A v1 clone
    // still persists verbatim (its disabled featuredDrop preserved, not dropped).
    const original = {
      toJSON: () => ({
        id: 'c2', name: 'V1', status: 'active',
        design_config: structuredClone(adminRichDoc), // untagged v1 doc
        slug: 'v1', firstActivatedAt: new Date(),
      }),
    };
    models.Campaign.findOne.mockResolvedValue(original);
    models.Campaign.create.mockImplementation(async (data) => ({ id: 'c3', ...data, toJSON: () => ({ id: 'c3' }) }));
    await duplicateCampaign('c2', {}, { user: { id: 'u1', role: 'agent' } });
    const created = models.Campaign.create.mock.calls[0][0];
    expect(created.design_config.version).toBeUndefined();
    expect(created.design_config.marketplaceListed).toBeUndefined(); // never-clone
    expect(created.design_config.featuredDrop.enabled).toBe(false); // preserved, disabled
  });

  it('ensureDrawTermsVersion pins terms from form.terms.html on a v2 doc', async () => {
    const d = {
      DrawTermsVersion: {
        findOne: jest.fn(async () => null),
        max: jest.fn(async () => 2),
        create: jest.fn(async (fields) => ({ id: 'dtv-9', ...fields })),
      },
    };
    const doc = { ...structuredClone(v2Rich), luckyDraw: { enabled: true, closesAt: '2026-08-30' } };
    const out = await ensureDrawTermsVersion(doc, 'c9', 'u1', d);
    expect(d.DrawTermsVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: adminRichDoc.termsContent.trim(), version: 3 })
    );
    expect(out.luckyDraw.termsVersionId).toBe('dtv-9');
  });

  it('ensureDrawTermsVersion still 422s a v2 draw without terms', async () => {
    const doc = {
      version: 2,
      form: { terms: { template: 'default', html: '   ' } },
      luckyDraw: { enabled: true, closesAt: '2026-08-30' },
    };
    await expect(ensureDrawTermsVersion(doc, 'c9', 'u1')).rejects.toMatchObject({ statusCode: 422 });
  });
});
