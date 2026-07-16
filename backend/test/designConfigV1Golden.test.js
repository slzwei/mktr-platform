/**
 * v1 clamp GOLDEN regression — proves design_config v2 work never changes what
 * the save path does to UNTAGGED (v1) documents.
 *
 * The oracle artifact (test-fixtures/designConfigV1ClampOracle.json) was
 * captured from the PRE-v2 base commit 7b5f0dd by running THIS file with
 * CAPTURE_ORACLE=1 before any v2 code existed (see the artifact's provenance
 * header). Normal runs assert structural equality against it, so any
 * behavioral drift in clampDesignConfig / buildPublicDesignConfig for v1 docs
 * fails here. If v1 behavior must ever change deliberately, re-capture and
 * commit the new artifact in the same PR with the reason.
 */
import { jest } from '@jest/globals';
import './setup.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Inert module mocks so importing campaignService never touches models/db —
// same seam set as test/unit/campaignService.test.js. The functions under test
// (clampDesignConfig / buildPublicDesignConfig) are pure and use none of them.
import { Op } from 'sequelize';
jest.unstable_mockModule('../src/models/index.js', () => ({
  Campaign: {}, QrTag: {}, Prospect: {}, Commission: {}, Device: {},
  CampaignMediaItem: {}, CampaignAgentAssignment: {},
  sequelize: { transaction: jest.fn() },
  DrawTermsVersion: {
    findOne: async () => null,
    max: async () => null,
    create: async (fields) => ({ id: 'dtv-mock', ...fields }),
  },
  Op,
}));
jest.unstable_mockModule('../src/middleware/tenant.js', () => ({
  getTenantId: jest.fn(),
}));
jest.unstable_mockModule('../src/services/storage.js', () => ({
  storageService: {},
}));
jest.unstable_mockModule('../src/services/pushService.js', () => ({
  pushService: { sendEvent: jest.fn() },
}));
jest.unstable_mockModule('../src/services/walletService.js', () => ({
  refundCampaignCommitments: jest.fn(async () => ({ refunded: 0, totalCents: 0 })),
}));

const { clampDesignConfig } = await import('../src/services/campaignService.js');
const { buildPublicDesignConfig } = await import('../src/utils/publicDesignConfig.js');
const { V1_DOCS, adminRichDoc } = await import('../../test-fixtures/designConfigV1Docs.mjs');

const ORACLE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../test-fixtures/designConfigV1ClampOracle.json'
);

const ROLES = ['admin', 'agent', undefined];
const STORED_VARIANTS = { create: undefined, updateOverRich: adminRichDoc };

function captureAll() {
  const out = {};
  for (const [docName, doc] of Object.entries(V1_DOCS)) {
    for (const role of ROLES) {
      for (const [storedName, stored] of Object.entries(STORED_VARIANTS)) {
        const key = `${docName}::role=${role ?? 'none'}::stored=${storedName}`;
        out[key] = clampDesignConfig(structuredClone(doc), structuredClone(stored), role);
      }
    }
    out[`${docName}::public`] = buildPublicDesignConfig(structuredClone(doc));
  }
  return out;
}

describe('design_config v1 golden (oracle captured at base 7b5f0dd)', () => {
  if (process.env.CAPTURE_ORACLE === '1') {
    it('captures the oracle artifact (CAPTURE_ORACLE=1)', () => {
      const artifact = {
        __provenance: {
          capturedAt: 'pre-v2 implementation',
          baseCommit: '7b5f0dd',
          note: 'Output of clampDesignConfig/buildPublicDesignConfig BEFORE any design_config-v2 code. Do not regenerate casually.',
        },
        results: captureAll(),
      };
      writeFileSync(ORACLE_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
      expect(Object.keys(artifact.results).length).toBeGreaterThan(0);
    });
    return;
  }

  const oracle = JSON.parse(readFileSync(ORACLE_PATH, 'utf8'));

  it('covers every fixture × role × stored combo present at capture time', () => {
    expect(Object.keys(captureAll()).sort()).toEqual(Object.keys(oracle.results).sort());
  });

  for (const key of Object.keys(V1_DOCS)) {
    it(`v1 clamp + public output unchanged for fixture "${key}"`, () => {
      const now = captureAll();
      for (const [comboKey, expected] of Object.entries(oracle.results)) {
        if (!comboKey.startsWith(`${key}::`)) continue;
        // JSON round-trip the live value so undefined-vs-absent matches what
        // the artifact can represent (structural equality, not byte identity).
        expect(JSON.parse(JSON.stringify(now[comboKey] ?? null))).toEqual(expected);
      }
    });
  }
});
