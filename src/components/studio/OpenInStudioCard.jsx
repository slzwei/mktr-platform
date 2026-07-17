import { Link } from 'react-router-dom';
import { studioPath } from './studioFlag';

/**
 * Workspace Design-tab replacement while VITE_CAMPAIGN_STUDIO_ENABLED is on
 * (Studio PR 3). The classic DesignEditor stays mounted for guided_review
 * campaigns (their designer is out of Studio scope) and everywhere while the
 * flag is off.
 */
export default function OpenInStudioCard({ campaignId }) {
  return (
    <div
      className="h-full flex items-center justify-center"
      style={{ minHeight: 320 }}
      data-testid="open-in-studio-card"
    >
      <div className="max-w-md text-center space-y-3 p-8 rounded-2xl border border-border bg-card">
        <div className="text-3xl" aria-hidden="true">
          🎛️
        </div>
        <h3 className="text-lg font-semibold">This campaign is designed in Campaign Studio</h3>
        <p className="text-sm text-muted-foreground">
          The Studio is the full-screen editor for the campaign page, form, quiz, theme and
          distribution — with a live device preview of the unsaved document.
        </p>
        <Link
          to={studioPath(campaignId)}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Open Campaign Studio →
        </Link>
      </div>
    </div>
  );
}
