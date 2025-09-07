import { createProxyMiddleware } from 'http-proxy-middleware';

const target = process.env.GATEWAY_INTERNAL_URL || 'http://gateway:4000';

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
  const mw = createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: (path) => rewritePath(path),
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader('x-deprecated-route', 'leadgen-monolith-shim');
    }
  });

  return function shim(req, res, next) {
    const p = req.path || '';
    if (/^\/api\/(v1\/)?(qrcodes|prospects|commissions|variants)(\/|$)/.test(p)) {
      // TODO: Return 410 after one-week grace period
      return mw(req, res, next);
    }
    return next();
  };
}

export default leadgenProxyShim;


