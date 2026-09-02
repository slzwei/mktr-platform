/**
 * The page a sandbox shows when its application logic could not load.
 *
 * `server.js` starts a bare shell first and imports the real app afterwards, so a
 * configuration error — a missing DATABASE_URL is the common one — leaves the
 * shell listening with no routes mounted. Express then answers every request
 * with "Cannot GET /", which tells a tester nothing and looks like a broken
 * deploy rather than an unfinished one.
 *
 * This renders the actual state instead. It reports only whether each required
 * variable is PRESENT — never a value, and never the underlying error message,
 * which for a database fault can contain a connection string. The details stay
 * in the service logs.
 */

const REQUIRED = [
  ['DATABASE_URL or DB_HOST', () => Boolean(process.env.DATABASE_URL || process.env.DB_HOST)],
  ['JWT_SECRET', () => Boolean(process.env.JWT_SECRET)],
  ['DEPLOY_ENV', () => Boolean(process.env.DEPLOY_ENV)],
  ['SANDBOX_SPA_DIR', () => Boolean(process.env.SANDBOX_SPA_DIR)],
];

export function bootStatus() {
  const checks = REQUIRED.map(([name, present]) => ({ name, present: present() }));
  return {
    status: 'not_started',
    deployEnv: process.env.DEPLOY_ENV || null,
    missing: checks.filter((c) => !c.present).map((c) => c.name),
    checks,
  };
}

const escape = (value) =>
  String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderBootFailurePage() {
  const state = bootStatus();
  const rows = state.checks
    .map(
      (c) =>
        `<li class="${c.present ? 'ok' : 'missing'}"><span>${c.present ? 'set' : 'not set'}</span>${escape(c.name)}</li>`,
    )
    .join('');
  const headline = state.missing.length
    ? `Missing configuration: ${state.missing.map(escape).join(', ')}`
    : 'Configuration looks complete — see the service logs for the failure.';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>SANDBOX — not started</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif;
         background:#faf9f7; color:#1c1917; }
  main { max-width:34rem; padding:2rem 1.5rem; }
  .band { background:repeating-linear-gradient(45deg,#b45309,#b45309 12px,#92400e 12px,#92400e 24px);
          color:#fff; font-weight:600; font-size:12px; letter-spacing:.04em; text-transform:uppercase;
          padding:6px 12px; border-radius:4px; display:inline-block; margin-bottom:1.25rem; }
  h1 { font-size:1.35rem; margin:0 0 .5rem; }
  p { margin:0 0 1rem; color:#57534e; }
  ul { list-style:none; padding:0; margin:0 0 1.25rem; border:1px solid #e7e5e4; border-radius:8px; overflow:hidden; }
  li { display:flex; gap:.75rem; align-items:center; padding:.6rem .85rem; border-top:1px solid #e7e5e4; }
  li:first-child { border-top:0; }
  li span { font-size:11px; text-transform:uppercase; letter-spacing:.04em; font-weight:600;
            padding:2px 7px; border-radius:99px; min-width:4.2rem; text-align:center; }
  .ok span { background:#dcfce7; color:#166534; }
  .missing span { background:#fee2e2; color:#991b1b; }
  code { background:#f5f5f4; padding:1px 5px; border-radius:4px; font-size:.9em; }
  @media (prefers-color-scheme: dark) {
    body { background:#1c1917; color:#fafaf9; }
    p { color:#a8a29e; }
    ul, li { border-color:#44403c; }
    code { background:#292524; }
  }
</style></head>
<body><main>
  <div class="band">Sandbox — not started</div>
  <h1>The sandbox API has not finished starting.</h1>
  <p>${escape(headline)}</p>
  <ul>${rows}</ul>
  <p>No request is being served and no data is at risk. Set the missing values on
  the <code>mktr-sandbox-api</code> service and redeploy; the deploy runbook is
  <code>docs/runbooks/mktr-sandbox.md</code>.</p>
</main></body></html>`;
}

export default { bootStatus, renderBootFailurePage };
