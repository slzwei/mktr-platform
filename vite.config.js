import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { visualizer } from 'rollup-plugin-visualizer'

// Resolve VITE_BRAND at config time so the chosen brand config file is the
// only one imported by `@/lib/brand`. This keeps unused brand strings out of
// the production bundle (acceptance test: grep dist/ for the inactive brand).
const BRAND = process.env.VITE_BRAND === 'redeem' ? 'redeem' : 'mktr'
const brandConfigPath = path.resolve(__dirname, `./src/lib/brandConfigs/${BRAND}.js`)

// Brand-aware defaults for %VITE_*% substitution in index.html. Each Render
// Static Site can still override via env, but the build never ships unresolved
// placeholders if an env var is missing.
const BRAND_HTML_DEFAULTS = BRAND === 'redeem'
  ? {
      VITE_PAGE_TITLE: 'Redeem — Lead Capture',
      VITE_FAVICON_SRC: '/redeem-favicon.svg',
      VITE_CANONICAL_BASE: 'https://redeem.sg/',
    }
  : {
      VITE_PAGE_TITLE: 'MKTR Marketing Platform',
      VITE_FAVICON_SRC: '/favicon.svg',
      VITE_CANONICAL_BASE: 'https://mktr.sg/',
    }

for (const [k, v] of Object.entries(BRAND_HTML_DEFAULTS)) {
  if (!process.env[k]) process.env[k] = v
}

// Emit brand-aware robots.txt and sitemap.xml into dist/ at build time.
// Public routes only — internal/admin paths are excluded from sitemap and
// disallowed in robots so search engines do not index login/admin surfaces.
function brandSeoFiles() {
  const host = BRAND === 'redeem' ? 'redeem.sg' : 'mktr.sg'
  const base = `https://${host}`
  // Routes that should be indexed on each brand.
  const sharedRoutes = ['/', '/LeadCapture', '/personal-data-policy', '/Contact']
  const mktrOnlyRoutes = ['/features', '/pricing', '/about']
  const routes = BRAND === 'redeem' ? sharedRoutes : [...sharedRoutes, ...mktrOnlyRoutes]

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
    'Disallow: /preview',
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