/**
 * Human-readable signup source phrase for a prospect's "created" activity line.
 *
 * The old template hardcoded `via {qrTag} QR code` for EVERY lead, so an ad- or
 * form-sourced lead (no QR tag) rendered as "via Unknown QR QR code" even when
 * its attribution clearly said TikTok/Meta. This derives the phrase from the
 * lead's actual source instead.
 *
 * The vocabulary deliberately mirrors the frontend admin Source-column badge
 * (`src/utils/normalizeProspect.js` → deriveAd / sourceDisplay) so the Activity
 * History prose and the badge agree: utm_source pins the ad platform, a bare
 * click-id is a "click" (organic links carry these too), and an explicit
 * leadSource='referral' wins over circumstantial UTM/click capture.
 *
 * `sourceMetadata` shape (built in prospectService.createProspect):
 *   { utm: { utm_source, ... }, ttclid, fbc, eventSourceUrl, referral: { referrerName } }
 */

const META_UTM_SOURCES = new Set(['facebook', 'fb', 'instagram', 'ig', 'meta']);
const TIKTOK_UTM_SOURCES = new Set(['tiktok', 'tt', 'tiktokads', 'tiktok_ads', 'tiktok-ads']);

/** utm_source -> ad platform display name (title-cased fallback for unknowns). */
function adPlatformName(utmSource) {
  const s = String(utmSource || '').toLowerCase();
  if (META_UTM_SOURCES.has(s)) return 'Meta';
  if (TIKTOK_UTM_SOURCES.has(s)) return 'TikTok';
  // Unknown source: title-case it, but bound the length — utm_source is
  // user-supplied (Joi caps it at 128) and feeds a STRING(255) column.
  return s ? s.slice(0, 64).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '';
}

/**
 * Build the "via …" clause for a signup, given the lead's source signals.
 * @param {object}  opts
 * @param {string}  [opts.leadSource]      Prospect.leadSource (website|qr_code|call_bot|referral|…)
 * @param {object}  [opts.qrTag]           the bound QrTag row (null when not a QR scan)
 * @param {object}  [opts.sourceMetadata]  Prospect.sourceMetadata (utm/click ids/referral)
 * @returns {string} e.g. "via TikTok ad", "via Marina Bay QR code", "via web form"
 */
export function signupSourcePhrase({ leadSource, qrTag, sourceMetadata } = {}) {
  const meta = sourceMetadata || {};
  const source = String(leadSource || '').toLowerCase();

  // Explicit referral intent wins over any circumstantial (same-tab) attribution.
  if (source === 'referral') {
    const name = meta.referral?.referrerName;
    return name ? `via referral from ${name}` : 'via referral';
  }

  // A bound QR tag is concrete evidence — prefer its name/label.
  if (qrTag) {
    const qrName = qrTag.name || qrTag.label;
    return qrName ? `via ${qrName} QR code` : 'via QR code';
  }
  if (source === 'qr_code') return 'via QR code';

  // Retell voice bot.
  if (source === 'call_bot') return 'via voice call';

  // Paid ad — a utm_source only appears on our ad URLs, so it pins the platform.
  const utmSource = meta.utm?.utm_source;
  if (utmSource) {
    const name = adPlatformName(utmSource);
    return name ? `via ${name} ad` : 'via ad';
  }

  // Click-id fingerprint only. Organic links carry these too, so this is
  // "came via a {platform} click", not a paid ad. Meta is checked first.
  const esu = meta.eventSourceUrl || '';
  if (meta.fbc || /[?&]fbclid=/i.test(esu)) return 'via Meta click';
  if (meta.ttclid || /[?&]ttclid=/i.test(esu)) return 'via TikTok click';

  // Plain landing-page form, or any other/unknown source.
  if (source === '' || source === 'website') return 'via web form';
  return `via ${source.replace(/_/g, ' ')}`;
}

/** Full "created" activity description: "Prospect signed up for {campaign} campaign {phrase}". */
export function signupActivityDescription(campaignName, opts = {}) {
  const name = campaignName || 'Unknown Campaign';
  const desc = `Prospect signed up for ${name} campaign ${signupSourcePhrase(opts)}`;
  // ProspectActivity.description is STRING(255) NOT NULL. A long campaign name
  // plus a long utm_source could overflow and throw inside the create
  // transaction (losing the lead) — clamp to keep the insert safe.
  return desc.length > 255 ? desc.slice(0, 255) : desc;
}

// Held leads never pass through the mktr-leads receiver (deriveLeadSource), so derive the
// SAME short label here for the admin dispatch queue — a held lead must read the same source
// it'll show once delivered. Granular fb/ig split (signupSourcePhrase above lumps them as
// "Meta"); an/msg/meta roll up to the Meta brand — matching receive-mktr-lead/leadSource.ts.
const LABEL_FACEBOOK = new Set(['facebook', 'fb']);
const LABEL_INSTAGRAM = new Set(['instagram', 'ig']);
const LABEL_META = new Set(['meta', 'an', 'audience_network', 'audiencenetwork', 'msg', 'messenger']);
const LABEL_TIKTOK = new Set(['tiktok', 'tt', 'tiktokads', 'tiktok_ads', 'tiktok-ads']);

function adPlatformLabel(utmSource) {
  const s = String(utmSource || '').toLowerCase();
  if (LABEL_FACEBOOK.has(s)) return 'Facebook';
  if (LABEL_INSTAGRAM.has(s)) return 'Instagram';
  if (LABEL_META.has(s)) return 'Meta';
  if (LABEL_TIKTOK.has(s)) return 'TikTok';
  return s ? s.slice(0, 64).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '';
}

/**
 * Short source label ("Instagram ad", "Meta ad", "QR code", "Web form", …) for a prospect —
 * mirrors the mktr-leads receiver's deriveLeadSource().label so a HELD lead's source reads
 * identically to the same lead once it's delivered to an agent. Keep in sync with
 * mktr-leads/supabase/functions/receive-mktr-lead/leadSource.ts.
 */
export function signupSourceLabel({ leadSource, qrTag, sourceMetadata } = {}) {
  const meta = sourceMetadata || {};
  const source = String(leadSource || '').toLowerCase();

  if (source === 'referral') return 'Referral';
  if ((qrTag && (qrTag.slug || qrTag.externalId)) || source === 'qr_code') return 'QR code';
  if (source === 'call_bot') return 'Voice call';

  const utmSource = meta.utm?.utm_source;
  if (utmSource) {
    const name = adPlatformLabel(utmSource);
    return name ? `${name} ad` : 'Ad';
  }

  const esu = meta.eventSourceUrl || '';
  if (meta.fbc || /[?&]fbclid=/i.test(esu)) return 'Meta click';
  if (meta.ttclid || /[?&]ttclid=/i.test(esu)) return 'TikTok click';

  if (source === '' || source === 'website') return 'Web form';
  return source.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default { signupSourcePhrase, signupActivityDescription, signupSourceLabel };
