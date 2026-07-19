import { asyncHandler } from '../middleware/errorHandler.js';
import { findConsumerByUnsubToken, applyUnsubscribe } from '../services/consentService.js';

/**
 * Public unsubscribe endpoint (PR B, plan §3.4).
 *
 * GET renders a confirm form and NEVER mutates — mail scanners prefetch
 * unsubscribe URLs, which is the whole reason RFC 8058 exists (Codex R1 #14).
 * POST is the mutation: the human form and the RFC 8058 one-click body both
 * land here; idempotent. The token is opaque and looked up BY HASH, so the
 * URL never exposes the cross-campaign consumer id.
 */

const page = (body) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Marketing preferences</title></head>
<body style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;background:#f7f7f8;margin:0;padding:40px 16px;">
<div style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:28px;color:#0d1619;">
${body}
<p style="color:#6b7280;font-size:12px;margin-top:24px;">Redeem &middot; MKTR PTE. LTD. (UEN 202507548M)</p>
</div></body></html>`;

const NOT_FOUND = page(
  '<h2 style="margin:0 0 8px;font-size:18px;">Link not recognised</h2>'
  + '<p style="font-size:14px;line-height:1.5;color:#374151;">This unsubscribe link is invalid or no longer active.</p>'
);

export const showUnsubscribe = asyncHandler(async (req, res) => {
  const token = String(req.query.t || '');
  const consumer = await findConsumerByUnsubToken(token);
  if (!consumer) return res.status(404).send(NOT_FOUND);
  return res.send(page(
    '<h2 style="margin:0 0 8px;font-size:18px;">Unsubscribe from marketing messages?</h2>'
    + '<p style="font-size:14px;line-height:1.5;color:#374151;">You will stop receiving marketing messages from Redeem. '
    + 'Service messages about rewards you have already claimed may still be sent.</p>'
    + `<form method="POST" action="/api/unsubscribe?t=${encodeURIComponent(token)}">`
    + '<button type="submit" style="background:#0d1619;color:#ffffff;border:0;border-radius:10px;padding:10px 18px;font-size:14px;cursor:pointer;">Unsubscribe</button>'
    + '</form>'
  ));
});

export const confirmUnsubscribe = asyncHandler(async (req, res) => {
  const token = String(req.query.t || req.body?.t || '');
  const consumer = await findConsumerByUnsubToken(token);
  if (!consumer) return res.status(404).send(NOT_FOUND);
  await applyUnsubscribe(consumer, { source: 'unsubscribe_link' });
  if ((req.get('accept') || '').includes('application/json')) {
    return res.json({ success: true });
  }
  return res.send(page(
    '<h2 style="margin:0 0 8px;font-size:18px;">You are unsubscribed</h2>'
    + '<p style="font-size:14px;line-height:1.5;color:#374151;">You will no longer receive marketing messages. '
    + 'Service messages about rewards you have already claimed may still be sent.</p>'
  ));
});
