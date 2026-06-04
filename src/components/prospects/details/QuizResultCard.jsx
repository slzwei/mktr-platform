import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import Sparkles from "lucide-react/icons/sparkles";
import ChevronDown from "lucide-react/icons/chevron-down";
import { prettyQid } from "@/lib/quizDisplay";

/**
 * QuizResultCard — shows a lead's quiz outcome on the prospect detail (admin +
 * agent share ProspectDetails, so both see it). Presentational: fed a `summary`
 * from extractQuizSummary(sourceMetadata); renders nothing when there's no quiz.
 * Mirrors the Call Recording card pattern in ProspectDetails.
 */

const BAND_CLASS = {
  Hot: "bg-destructive/15 text-destructive border-destructive/30",
  Warm: "bg-warning/15 text-warning border-warning/30",
  Cool: "bg-info/15 text-info border-info/30",
};

export default function QuizResultCard({ summary }) {
  const [open, setOpen] = useState(false);
  if (!summary) return null;

  const { title, profileId, readiness, agentAngle, leadScore, answers, verified } = summary;
  const bandClass =
    (leadScore && BAND_CLASS[leadScore.band]) || "bg-muted text-muted-foreground border-border";

  return (
    <Card className="border-border shadow-sm">
      <CardContent className="p-5 space-y-3">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" />
          Quiz Result
        </Label>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-semibold text-foreground">
            {title || profileId || "Unknown profile"}
          </span>
          {leadScore && leadScore.band && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${bandClass}`}>
              {leadScore.badge ? `${leadScore.badge} ` : ""}
              {leadScore.band}
              {typeof leadScore.points === "number" ? ` · ${leadScore.points} pts` : ""}
            </span>
          )}
        </div>

        {typeof readiness === "number" && (
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Protection readiness</span>
              <span className="font-semibold text-foreground">{readiness}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: `${Math.min(100, Math.max(0, readiness))}%` }}
              />
            </div>
          </div>
        )}

        {agentAngle && (
          <p className="text-sm text-foreground">
            <span className="text-muted-foreground">Suggested angle: </span>
            {agentAngle}
          </p>
        )}

        {answers.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
              {open ? "Hide" : "Show"} answers ({answers.length})
            </button>
            {open && (
              <ul className="mt-2 space-y-1">
                {answers.map((a, i) => (
                  <li key={a.qid || i} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground capitalize">{prettyQid(a.qid)}:</span>{" "}
                    {String(a.value)}
                    {a.tag ? ` (${a.tag})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {verified === false && (
          <p className="text-[11px] text-warning">
            Result not server-verified (campaign had no quiz config at submit time).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
