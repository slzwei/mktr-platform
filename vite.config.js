import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { visualizer } from 'rollup-plugin-visualizer'

// Resolve VITE_BRAND at config time so the chosen brand config file is the
// only one imported by `@/lib/brand`. This keeps unused brand strings out of
// the production bundle (acceptance test: grep dist/ for the inactive brand).
const BRAND = process.env.VITE_BRAND === 'redeem' ? 'redeem' : 'mktr'
const brandConfigPath = path.resolve(__dirname, `./src/lib/brandConfigs/${BRAND}.js`)

// Deployment identity (docs/plans/mktr-production-sandbox.md §4). A sandbox build
// is a PRODUCTION Vite build, so `import.meta.env.PROD` cannot tell them apart —
// VITE_DEPLOY_ENV is the only signal, and it must be exact.
const DEPLOY_ENV = (process.env.VITE_DEPLOY_ENV || '').trim().toLowerCase()
const IS_SANDBOX = DEPLOY_ENV === 'sandbox'
if (DEPLOY_ENV && !['production', 'sandbox', 'development'].includes(DEPLOY_ENV)) {
  throw new Error(`VITE_DEPLOY_ENV="${process.env.VITE_DEPLOY_ENV}" is not production | sandbox | development — refusing to build an environment we cannot name.`)
}

// Fail the BUILD, not the deploy, when a sandbox bundle carries a production
// advertising or analytics identifier. These are baked into dist/ and fire on
// first page view, so a copied env var would contaminate live ad optimisation
// and attribution before anyone noticed the banner.
if (IS_SANDBOX) {
  const PRODUCTION_TRACKING_IDS = {
    VITE_META_PIXEL_ID: '1402034528611431',
    VITE_TIKTOK_PIXEL_ID: 'D8GJ6T3C77UDLID6746G',
  }
  const contaminated = Object.entries(PRODUCTION_TRACKING_IDS)
    .filter(([key, value]) => process.env[key] && process.env[key].trim() === value)
    .map(([key]) => key)
  const anyTracking = ['VITE_META_PIXEL_ID', 'VITE_TIKTOK_PIXEL_ID', 'VITE_GOOGLE_ADS_CONVERSION_ID', 'VITE_GOOGLE_ADS_LEAD_LABEL', 'VITE_ADROLL_ADV_ID', 'VITE_ADROLL_PIX_ID']
    .filter((key) => process.env[key])
  if (contaminated.length > 0) {
    throw new Error(`Sandbox build refused: ${contaminated.join(', ')} carry PRODUCTION tracking ids. Unset them or map them to a test account.`)
  }
  if (anyTracking.length > 0 && process.env.SANDBOX_ALLOW_TRACKING_IDS !== 'true') {
    throw new Error(`Sandbox build refused: ${anyTracking.join(', ')} are set. Unset them, or set SANDBOX_ALLOW_TRACKING_IDS=true once they point at test accounts.`)
  }
  if (process.env.VITE_API_URL && process.env.VITE_API_URL !== '/api') {
    throw new Error(`Sandbox build refused: VITE_API_URL must be "/api" (same-origin) — got "${process.env.VITE_API_URL}".`)
  }
}

// Brand-aware defaults for %VITE_*% substitution in index.html. Each Render
// Static Site can still override via env, but the build never ships unresolved
// placeholders if an env var is missing.
const BRAND_HTML_DEFAULTS = BRAND === 'redeem'
  ? {
      VITE_PAGE_TITLE: 'Redeem — Free stuff from real Singapore brands',
      VITE_META_DESCRIPTION: 'Vouchers, lucky draws and partner offers from real Singapore brands. Claim in 30 seconds — no app, no points, no credit card. A service of MKTR PTE. LTD.',
      VITE_FAVICON_SRC: '/redeem-favicon.svg',
      VITE_CANONICAL_BASE: 'https://redeem.sg/',
    }
  : {
      VITE_PAGE_TITLE: 'MKTR — Lead Generation for Singapore Insurance Agents',
      VITE_META_DESCRIPTION: 'MKTR captures qualified insurance leads across Singapore and routes them to the right agent in seconds. Join the waitlist.',
      VITE_FAVICON_SRC: '/favicon.svg',
      VITE_CANONICAL_BASE: 'https://mktr.sg/',
    }

for (const [k, v] of Object.entries(BRAND_HTML_DEFAULTS)) {
  if (!process.env[k]) process.env[k] = v
}

// A sandbox is never indexed and never claims a production canonical URL.
if (IS_SANDBOX) {
  process.env.VITE_ROBOTS_CONTENT = 'noindex, nofollow, noarchive'
  process.env.VITE_CANONICAL_BASE = `https://${process.env.VITE_SANDBOX_HOST || 'sandbox.mktr.sg'}/`
  process.env.VITE_PAGE_TITLE = `SANDBOX — ${process.env.VITE_PAGE_TITLE}`
} else if (!process.env.VITE_ROBOTS_CONTENT) {
  process.env.VITE_ROBOTS_CONTENT = 'index, follow'
}

// Emit brand-aware robots.txt and sitemap.xml into dist/ at build time.
// Public routes only — internal/admin paths are excluded from sitemap and
// disallowed in robots so search engines do not index login/admin surfaces.
function brandSeoFiles() {
  // A sandbox build gets a blanket disallow and NO sitemap — a leaked sandbox
  // URL must never be crawled, and a sitemap would advertise it (plan §6.4).
  if (IS_SANDBOX) {
    const robots = ['User-agent: *', 'Disallow: /', ''].join('\n')
    return {
      name: 'mktr-brand-seo-files',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots })
      },
    }
  }

  // ops.redeem.sg is an internal staff tool — nothing on it should ever be
  // indexed, so its robots.txt is a blanket disallow and it gets no sitemap.
  if (process.env.VITE_SURFACE === 'ops') {
    const robots = ['User-agent: *', 'Disallow: /', ''].join('\n')
    return {
      name: 'mktr-brand-seo-files',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots })
      },
    }
  }

  const host = BRAND === 'redeem' ? 'redeem.sg' : 'mktr.sg'
  const base = `https://${host}`
  // Routes that should be indexed on each brand.
  const sharedRoutes = ['/', '/LeadCapture', '/personal-data-policy', '/Contact']
  // /features, /pricing, /about are hidden (show* flags false) pending a rewrite,
  // so they're intentionally excluded from the sitemap to avoid advertising 404s.
  const mktrOnlyRoutes = []
  // Marketplace v2 static surfaces — only advertised once the SPA flag is
  // baked ON for this build (while dark those routes 404, and a sitemap must
  // never advertise 404s). /offers/:slug pages are dynamic and get indexed
  // via crawl, not enumerated here.
  const marketplaceOn = process.env.VITE_REDEEM_MARKETPLACE_ENABLED === 'true'
  const redeemOnlyRoutes = [
    '/winners',
    ...(marketplaceOn
      ? ['/explore', '/dsa', '/how-it-works', '/businesses', '/about',
         '/c/education', '/c/lifestyle', '/legal/terms', '/legal/dnc', '/leads/privacy']
      : []),
  ]
  const routes = BRAND === 'redeem' ? [...sharedRoutes, ...redeemOnlyRoutes] : [...sharedRoutes, ...mktrOnlyRoutes]

  const robots = [
    'User-agent: *',
    // Allow public surfaces.
    'Allow: /',
    'Allow: /LeadCapture',
    'Allow: /personal-data-policy',
    'Allow: /Contact',
    // Disallow internal/admin/auth surfaces.
    'Disallow: /AdminLogin',
    'Disallow: /AdminDashboard',
    'Disallow: /Admin',
    'Disallow: /CustomerLogin',
    'Disallow: /ForgotPassword',
    'Disallow: /Onboarding',
    'Disallow: /PendingApproval',
    'Disallow: /auth/',
    'Disallow: /api/',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n')

  const today = new Date().toISOString().slice(0, 10)
  const urls = routes.map((path) => (
    `  <url>\n    <loc>${base}${path}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`
  )).join('\n')
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`

  return {
    name: 'mktr-brand-seo-files',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots })
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode: _mode }) => ({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    css: true,
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/test/**', 'src/components/ui/**', 'src/dev/**'],
      // Ratchet, not aspiration (P3-6): measured 2026-08-02 at 49.4/47.6/39.7/51.5
      // — set ~1.5 points under so coverage can never silently halve. Raise as
      // real coverage rises; never lower to make a red build pass.
      thresholds: {
        statements: 48,
        branches: 46,
        functions: 38,
        lines: 50,
      },
    },
  },
  plugins: [
    react(),
    brandSeoFiles(),
    // Enable visualizer only when ANALYZE env is set
    process.env.ANALYZE && visualizer({
      filename: 'dist/stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ].filter(Boolean),
  server: {
    allowedHosts: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@brand-config': brandConfigPath,
    },
    extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json']
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
}))