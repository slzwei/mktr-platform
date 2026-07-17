import { formatDrawDate } from '@/components/campaignPage/CampaignPageRenderer';

/**
 * Studio top bar (Studio PR 3) — campaign switcher, status/draw chips,
 * readiness pill (wired in CP6; hidden until a `readiness` prop arrives),
 * Copy link / Share preview (guarded), save cluster.
 *
 * Honesty rules (mock §PREVIEW & SAVE + appendix bug #9):
 *  - Copy/Share always operate on the last SAVED state → guarded while dirty.
 *  - "Saved · live on {host}" only for ACTIVE campaigns, host from the SAVED doc.
 */

const STATUS_TONES = {
  active: { color: '#1F7A46', bg: '#E2F2E8' },
  draft: { color: '#5B616E', bg: '#EFF1F4' },
  paused: { color: '#8A5B07', bg: '#F8EED8' },
  archived: { color: '#8F2F28', bg: '#FBE9E7' },
};

export function deriveSaveStatus({ saving, dirty, savedAt, isStoredV1, campaignStatus, savedHostName }) {
  if (saving) return 'Saving…';
  if (dirty) return 'Unsaved changes';
  if (savedAt) {
    return campaignStatus === 'active'
      ? `Saved · live on ${savedHostName}`
      : 'Saved (draft — goes live with the campaign)';
  }
  return isStoredV1 ? 'No changes · first save upgrades this campaign to the Studio format' : 'No changes';
}

export default function StudioTopBar({
  campaign,
  campaigns = [],
  savedHostName,
  dirty,
  saving,
  savedAt,
  saveError,
  isStoredV1,
  drawInfo, // doc.luckyDraw from the WORKING doc (chip is display-only)
  readiness = null, // CP6
  onReadinessOpen,
  onSave,
  onSwitchCampaign,
  onBack,
  onCopyLink,
  onSharePreview,
}) {
  const statusTone = STATUS_TONES[campaign?.status] || STATUS_TONES.draft;
  const drawCloses = drawInfo?.enabled === true ? formatDrawDate(drawInfo.closesAt) : '';
  const saveStatus = deriveSaveStatus({
    saving,
    dirty,
    savedAt,
    isStoredV1,
    campaignStatus: campaign?.status,
    savedHostName,
  });
  const dotColor = dirty ? '#D97C0B' : savedAt ? '#1F7A46' : '#C6CAD2';

  return (
    <header
      style={{
        height: 56,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 14px',
        background: 'var(--surface, #fff)',
        borderBottom: '1px solid var(--line, #E3E6EB)',
      }}
    >
      <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={onBack}>
        ← Campaign
      </button>

      <select
        aria-label="Switch campaign"
        className="av2-input"
        style={{ width: 230, height: 34, fontSize: 13 }}
        value={campaign?.id || ''}
        onChange={(e) => onSwitchCampaign(e.target.value)}
        title={
          campaigns.length >= 200
            ? 'Showing the newest 200 campaigns — open the campaign from the Campaigns list if it is missing here.'
            : undefined
        }
      >
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.status && c.status !== 'active' ? ` · ${c.status}` : ''}
          </option>
        ))}
      </select>

      <span
        className="av2-chip"
        style={{ color: statusTone.color, background: statusTone.bg, fontWeight: 700, letterSpacing: '.04em' }}
      >
        {(campaign?.status || 'draft').toUpperCase()}
      </span>

      {drawCloses ? (
        <span className="av2-chip" style={{ background: '#171A20', color: '#fff', fontWeight: 600 }}>
          🎁 DRAW · CLOSES {drawCloses.toUpperCase()}
        </span>
      ) : null}

      {readiness ? (
        <button
          type="button"
          className="av2-chip"
          onClick={onReadinessOpen}
          style={{
            cursor: 'pointer',
            border: 'none',
            fontWeight: 700,
            color: readiness.tone === 'bad' ? '#8F2F28' : readiness.tone === 'warn' ? '#8A5B07' : '#1F7A46',
            background: readiness.tone === 'bad' ? '#FBE9E7' : readiness.tone === 'warn' ? '#F8EED8' : '#E2F2E8',
          }}
        >
          {readiness.label}
        </button>
      ) : null}

      <div style={{ flex: 1 }} />

      <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={onCopyLink}>
        Copy link
      </button>
      <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={onSharePreview}>
        Share preview
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 6 }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: dotColor, flexShrink: 0 }} />
        <span
          data-testid="studio-save-status"
          style={{ fontSize: 12, color: saveError ? '#8F2F28' : 'var(--ink-2, #5B616E)', maxWidth: 300 }}
        >
          {saveError ? saveError.message : saveStatus}
        </span>
        <button
          type="button"
          className="av2-btn av2-btn--primary av2-btn--sm"
          onClick={onSave}
          disabled={!dirty || saving}
          title="⌘S / Ctrl+S"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </header>
  );
}
