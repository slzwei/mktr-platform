import { createProxyMiddleware } from 'http-proxy-middleware';

const target = process.env.GATEWAY_INTERNAL_URL || 'http://gateway:4000';

function getReqHost(req) {
  const xfHost = (req.headers['x-forwarded-host'] || '').toString().trim().toLowerCase();
  const host = (req.headers.host || '').toString().trim().toLowerCase();
  return xfHost || host;
}

function isSelfProxy(req) {
  try {
    const reqHost = getReqHost(req);
    const targetHost = new URL(target).host.toLowerCase();
    if (!reqHost || !targetHost) return false;
    return reqHost === targetHost;
  } catch (_) {
    return false;
  }
}

function rewritePath(path) {
  if (!path.startsWith('/api/')) return path;
  const rest = path.replace(/^\/api\//, '');
  const bases = [
    'v1/qrcodes',
    'v1/prospects',
    'v1/commissions',
    'qrcodes',
    'prospects',
    'commissions',
    'variants'
  ];
  for (const b of bases) {
    if (rest.startsWith(b)) {
      return `/api/leadgen/${rest}`;
    }
  }
  return path;
}

export function leadgenProxyShim() {
  const forceOff = String(process.env.LEGACY_SHIM_FORCE_OFF || '').toLowerCase() === 'true';
  const mw = createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: (path) => rewritePath(path),
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader('x-deprecated-route', 'leadgen-monolith-shim');
    }
  });

  return function shim(req, res, next) {
    if (forceOff) {
      res.setHeader('x-legacy-shim-bypass', 'force-off');
      return next();
    }
    const p = req.path || '';
    if (/^\/api\/(v1\/)?(qrcodes|prospects|commissions|variants)(\/|$)/.test(p)) {
      // Self-proxy guard: if target host equals current host, bypass proxy to avoid 504 loops
      if (isSelfProxy(req)) {
        res.setHeader('x-legacy-shim-bypass', 'self-proxy-guard');
        return next();
      }
      // TODO: Return 410 after one-week grace period
      return mw(req, res, next);
    }
    return next();
  };
}

export default leadgenProxyShim;


