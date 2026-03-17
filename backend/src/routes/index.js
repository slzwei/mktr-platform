import { readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Auto-discover and mount all route files that export a `meta` descriptor.
 *
 * Each route file may export:
 *   export const meta = { path: '/api/foo' }
 *   export const meta = { path: '/api/foo', flag: 'FEATURE_X' }
 *   export const meta = { path: '/api/foo', flag: 'FEATURE_X', flagDefault: 'true' }
 *   export const meta = { path: '/api/foo', priority: -1 }
 *   export const meta = { mounts: [{ path: '/api/foo' }, { path: '/api/bar', flag: 'X' }] }
 *
 * Files without a `meta` export (e.g. middleware, this index) are silently skipped.
 * Routes are sorted by priority (lower first, default 0), then alphabetically by filename.
 */
export async function loadRoutes(app) {
  const files = (await readdir(__dirname))
    .filter(f => f.endsWith('.js') && f !== 'index.js')
    .sort();

  // Collect all route modules with meta
  const routes = [];
  for (const file of files) {
    const mod = await import(path.join(__dirname, file));
    if (mod.meta && mod.default) {
      routes.push({ file, router: mod.default, meta: mod.meta });
    }
  }

  // Sort by priority (lower first, default 0) — stable sort preserves alpha order within same priority
  routes.sort((a, b) => (a.meta.priority || 0) - (b.meta.priority || 0));

  let mounted = 0;

  for (const { file, router, meta } of routes) {
    const mounts = meta.mounts || [{ path: meta.path, flag: meta.flag, flagDefault: meta.flagDefault }];

    for (const mount of mounts) {
      // Check feature flag
      if (mount.flag) {
        const flagValue = String(process.env[mount.flag] || mount.flagDefault || 'false').toLowerCase();
        if (flagValue !== 'true') {
          logger.debug('Route skipped (flag off)', { path: mount.path, flag: mount.flag, file });
          continue;
        }
      }

      app.use(mount.path, router);
      mounted++;
      logger.debug('Route mounted', { path: mount.path, file });
    }
  }

  logger.info(`Auto-loaded ${mounted} route mount(s) from ${routes.length} route file(s)`);
}
