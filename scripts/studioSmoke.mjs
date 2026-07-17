/**
 * Campaign Studio — Playwright smoke harness (Studio PR 3).
 *
 * No backend: serves an mktr build made with VITE_API_URL=/api (same-origin,
 * interceptable) + the Studio flag baked on, seeds an admin session into
 * localStorage (authStore hydrates from mktr_user/mktr_auth_token), and
 * fulfills every /api/** route with fixtures.
 *
 * Proves the things jsdom can't:
 *   1. true-viewport DeviceFrame — the page iframe really is 390/1280 wide
 *      (window.innerWidth + matchMedia inside the frame) on a 1440 parent;
 *   2. the real renderer mounts inside the frame ([data-campaign-page-ready]);
 *   3. the funnel-state jumper drives the frame (OTP panel copy appears);
 *   4. doc edits flow live WITHOUT remounting the funnel (the jumped OTP
 *      panel survives a headline edit — F11);
 *   5. Save PUTs the WHOLE v2 doc (version 2, quiz passthrough, edited copy)
 *      and the top bar reports "Saved · live on redeem.sg";
 *   6. zero capture-side network (no /prospects, /verify, /dnc calls);
 *   7. AI copy assist (PR 4): canned /admin/ai/copy-draft intercept → Generate
 *      → Accept updates the live frame → the next save PUT carries the
 *      accepted value. Zero real provider traffic.
 *
 * Usage (repo root):
 *   VITE_BRAND=mktr VITE_API_URL=/api \
 *     VITE_ADMIN_V2_ENABLED=true npx vite build --outDir dist-studio-smoke
 *   npx vite preview --outDir dist-studio-smoke --port 4321 --strictPort &
 *   node scripts/studioSmoke.mjs 4321 /tmp/studio-smoke
 */
import { mkdirSync, existsSync } from 'node:fs';

// Resolve playwright from this checkout OR the parent checkout (git worktrees
// under .claude/worktrees/<name> share the main repo's node_modules via the
// directory walk npm does — plain ESM imports don't, so walk explicitly).
const PW_CANDIDATES = [
  new URL('../node_modules/playwright/index.mjs', import.meta.url),
  new URL('../../../../node_modules/playwright/index.mjs', import.meta.url),
];
const pwUrl = PW_CANDIDATES.find((u) => existsSync(u));
if (!pwUrl) {
  console.error('playwright not found — npm i playwright (or run from the main checkout)');
  process.exit(1);
}
const { chromium } = await import(pwUrl.href);

const PORT = process.argv[2] || '4321';
const OUT = process.argv[3] || '/tmp/studio-smoke';
mkdirSync(OUT, { recursive: true });
const BASE = `http://localhost:${PORT}`;

const ADMIN = { id: 'admin-1', full_name: 'Smoke Admin', email: 'admin@mktr.sg', role: 'admin', status: 'active' };

const CAMPAIGN = {
  id: 'c-smoke',
  name: 'FairPrice Voucher',
  slug: 'fairprice-smoke',
  status: 'active',
  is_active: true,
  type: 'lead_generation',
  min_age: 18,
  max_age: 65,
  firstActivatedAt: null,
  design_config: {
    formHeadline: 'Get your $10 voucher',
    formSubheadline: 'Your voucher code arrives by SMS after verification.',
    brandWordmark: 'redeem.sg',
    storyText: 'We are giving away 2,000 vouchers.\n\nSign up and verify your number.',
    ctaText: 'Redeem Now',
    themeColor: '#D17029',
    heroFont: 'fraunces',
    customerHost: 'redeem',
    otpChannel: 'sms',
    sgPrOnly: true,
    dncCheckAtSubmit: true,
    visibleFields: { dob: true, postal_code: true },
    requiredFields: {},
  },
};

const READINESS = { applicable: true, ready: true, issues: [] };
const MK_PREVIEW = {
  id: 'c-smoke',
  slug: 'fairprice-smoke',
  name: 'FairPrice Voucher',
  design_config: {},
  ops: null,
  gate: { listed: false, slug: true, active: true, marketplaceListed: false, redeemHost: true, supportedType: true, opsResolvable: false },
};

const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  let savedBody = null;
  const forbidden = [];
  const aiCalls = [];

  await page.addInitScript(
    ({ admin }) => {
      localStorage.setItem('mktr_auth_token', 'smoke-token');
      localStorage.setItem('mktr_user', JSON.stringify(admin));
    },
    { admin: ADMIN }
  );

  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (/\/(prospects|verify|dnc|shortlinks)\b/.test(url)) {
      forbidden.push(`${method} ${url}`);
      return route.fulfill({ status: 500, body: '{}' });
    }
    if (url.includes('/auth/profile')) return route.fulfill(ok({ user: ADMIN }));
    if (url.includes('/admin/ai/copy-draft')) {
      aiCalls.push(route.request().postDataJSON());
      return route.fulfill(
        ok({
          // story is visible in the hero at the RESTING funnel state (the
          // sgPrOnly fixture rests on the gate, so the form headline is not) —
          // the accepted row must be assertable inside the frame.
          draft: [
            { path: 'content.story', label: 'Hero story', section: 'page', value: 'AI smoke story line for the hero.' },
            { path: 'content.submitLabel', label: 'Submit button label', section: 'page', value: 'Claim my voucher' },
          ],
        })
      );
    }
    if (url.includes('/campaigns/slug-availability')) return route.fulfill(ok({ valid: true, available: true }));
    if (url.includes('/campaigns/c-smoke/readiness')) return route.fulfill(ok({ readiness: READINESS }));
    if (url.includes('/campaigns/c-smoke/marketplace-preview')) return route.fulfill(ok({ campaign: MK_PREVIEW }));
    if (url.includes('/campaigns/c-smoke') && method === 'PUT') {
      savedBody = route.request().postDataJSON();
      return route.fulfill(ok({ campaign: { ...CAMPAIGN, design_config: savedBody.design_config, slug: savedBody.slug ?? CAMPAIGN.slug } }));
    }
    if (url.includes('/campaigns/c-smoke')) return route.fulfill(ok({ campaign: CAMPAIGN }));
    if (/\/campaigns(\?|$)/.test(url)) return route.fulfill(ok({ campaigns: [CAMPAIGN] }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false }) });
  });

  const assert = (cond, label) => {
    if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
    console.log(`  ✓ ${label}`);
  };

  console.log('1. Studio mounts (flag-on build, admin session)');
  await page.goto(`${BASE}/admin/campaigns/c-smoke/studio`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Distribution' }).waitFor({ timeout: 15000 });
  assert(await page.getByRole('button', { name: 'Save' }).isVisible(), 'save cluster renders');
  assert(await page.getByText('READY ✓').isVisible(), 'merged readiness pill is READY on the clean fixture');

  console.log('2. True-viewport DeviceFrame');
  const frame = page.frameLocator('iframe[title="Campaign page preview"]');
  await frame.locator('[data-campaign-page-ready="true"]').waitFor({ timeout: 15000 });
  const frameEl = page.locator('iframe[title="Campaign page preview"]');
  const inner = await frameEl.evaluate((el) => ({
    w: el.contentWindow.innerWidth,
    mobileMq: el.contentWindow.matchMedia('(max-width: 640px)').matches,
  }));
  assert(inner.w === 390, `frame window.innerWidth is 390 (got ${inner.w}) on a 1440 parent`);
  assert(inner.mobileMq === true, 'mobile media query matches INSIDE the frame');
  await page.screenshot({ path: `${OUT}/studio-390.png` });

  await page.getByRole('button', { name: 'Desktop · 1280' }).click();
  const innerDesktop = await frameEl.evaluate((el) => el.contentWindow.innerWidth);
  assert(innerDesktop === 1280, `desktop toggle gives a real 1280 viewport (got ${innerDesktop})`);
  await page.screenshot({ path: `${OUT}/studio-1280.png` });
  await page.getByRole('button', { name: 'Mobile · 390' }).click();

  console.log('3. Funnel-state jumper drives the frame');
  await page.getByRole('button', { name: /State: Default/ }).click();
  await page.getByRole('menuitem', { name: 'OTP panel open' }).click();
  await frame.getByText(/Enter the 6-digit code sent via/).waitFor({ timeout: 10000 });
  assert(true, 'OTP panel open renders inside the frame');
  await page.screenshot({ path: `${OUT}/studio-jump-otp.png` });

  console.log('4. Live doc edits do NOT remount the jumped funnel (F11)');
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  const headline = page.getByLabel('Form headline', { exact: true }); // the field, not its ✦ suggest button
  await headline.fill('Fresh smoke headline');
  await frame.getByText(/Enter the 6-digit code sent via/).waitFor({ timeout: 5000 });
  assert(true, 'OTP state survived the headline edit');

  console.log('5. Save PUTs the whole v2 doc');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved · live on redeem.sg').waitFor({ timeout: 10000 });
  assert(savedBody?.design_config?.version === 2, 'PUT carried a version:2 document');
  assert(savedBody.design_config.content.headline === 'Fresh smoke headline', 'edited copy rode the PUT');
  assert(savedBody.design_config.form.gates.sgPr === true && savedBody.design_config.form.gates.dncCheck === true, 'v1 gates migrated into form.gates');
  assert(savedBody.design_config.customerHost === 'redeem', 'legacy customerHost mirror present');

  console.log('6. Zero capture-side network');
  assert(forbidden.length === 0, `no /prospects|/verify|/dnc|/shortlinks calls (got: ${forbidden.join(', ') || 'none'})`);

  console.log('7. AI copy assist — canned draft → Accept → live frame + save PUT');
  await page.getByRole('button', { name: 'Reset preview state' }).click(); // back to the resting page
  await page.getByRole('button', { name: '✦ Write it for me' }).click();
  await page.getByPlaceholder(/FairPrice voucher giveaway/).fill('$10 voucher giveaway for new members');
  await page.getByRole('button', { name: 'Generate suggestions' }).click();
  await page.getByText('2 fields drafted — nothing applied yet').waitFor({ timeout: 10000 });
  assert(aiCalls.length === 1 && aiCalls[0].mode === 'copy' && aiCalls[0].campaignId === 'c-smoke', 'one copy-draft call with the campaign scope');
  await page.getByTestId('ai-sug-content.story').getByRole('button', { name: 'Accept' }).click();
  await frame.getByText(/AI smoke story line/).waitFor({ timeout: 10000 });
  assert(true, 'accepted value rendered live inside the device frame');
  await page.screenshot({ path: `${OUT}/studio-ai-accept.png` });
  await page.getByRole('button', { name: 'Close AI panel' }).click();
  savedBody = null;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved · live on redeem.sg').waitFor({ timeout: 10000 });
  assert(savedBody?.design_config?.content?.story === 'AI smoke story line for the hero.', 'accepted AI copy rode the save PUT');
  assert(savedBody.design_config.content.submitLabel !== 'Claim my voucher', 'un-accepted row did NOT ride the PUT');

  await browser.close();
  console.log(`\nSMOKE PASS — screenshots in ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
