export function validateCreateQr(req, res, next) {
  const { code, status = 'active', campaign_id = null, car_id = null, owner_user_id = null } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ code: 400, status: 'error', error: 'code required' });
  }
  if (!status || typeof status !== 'string') {
    return res.status(400).json({ code: 400, status: 'error', error: 'status required' });
  }
  req.body = { code, status, campaign_id, car_id, owner_user_id };
  return next();
}

export function validateListQr(req, res, next) {
  const { limit, cursor, sort } = req.query || {};
  if (limit !== undefined && (isNaN(Number(limit)) || Number(limit) <= 0 || Number(limit) > 200)) {
    return res.status(400).json({ code: 400, status: 'error', error: 'limit must be number 1..200' });
  }
  if (cursor !== undefined && typeof cursor !== 'string') {
    return res.status(400).json({ code: 400, status: 'error', error: 'cursor must be string' });
  }
  if (sort !== undefined && typeof sort !== 'string') {
    return res.status(400).json({ code: 400, status: 'error', error: 'sort must be string' });
  }
  return next();
}


