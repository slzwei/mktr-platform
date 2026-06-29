import { format } from "date-fns";
import {
  CheckCircle2,
  UserPlus,
  RefreshCw,
  Undo2,
  Hourglass,
  Phone,
  MessageCircle,
  Users,
  Mail,
  FileText,
  Flag,
  Trophy,
  AlertCircle,
  Archive,
  ArchiveRestore,
  Trash2,
  UserX,
  Eye,
  Circle,
  Clock,
} from "lucide-react";
import { buildTimeline } from "@/utils/leadTimeline";

// Canonical kind → icon + tint. SAME vocabulary as the mktr-leads app (lib/leadMeta), rendered
// with lucide (the app uses Ionicons) so the two surfaces read the same.
const KIND_META = {
  lead_created: { Icon: CheckCircle2, color: "text-success" },
  assigned: { Icon: UserPlus, color: "text-plum" },
  reassigned: { Icon: RefreshCw, color: "text-plum" },
  returned: { Icon: Undo2, color: "text-amber-500" },
  unassigned: { Icon: Undo2, color: "text-amber-500" },
  held: { Icon: Hourglass, color: "text-amber-500" },
  call: { Icon: Phone, color: "text-primary" },
  whatsapp: { Icon: MessageCircle, color: "text-green-500" },
  meeting: { Icon: Users, color: "text-primary" },
  email: { Icon: Mail, color: "text-primary" },
  note: { Icon: FileText, color: "text-muted-foreground" },
  status_changed: { Icon: Flag, color: "text-primary" },
  won: { Icon: Trophy, color: "text-success" },
  disputed: { Icon: AlertCircle, color: "text-red-500" },
  archived: { Icon: Archive, color: "text-muted-foreground" },
  unarchived: { Icon: ArchiveRestore, color: "text-muted-foreground" },
  deleted: { Icon: Trash2, color: "text-red-500" },
  account_deleted: { Icon: UserX, color: "text-red-500" },
  viewed: { Icon: Eye, color: "text-muted-foreground" },
  updated: { Icon: Circle, color: "text-muted-foreground" },
};

export default function ActivityTimeline({ details, prospect, campaign }) {
  const entries = buildTimeline(details);

  return (
    <section>
      <h3 className="text-lg font-semibold text-foreground mb-4">Activity History</h3>
      <div className="relative pl-6 space-y-6">
        <div className="absolute left-[11px] top-2 bottom-4 w-px bg-muted" />

        {entries.length === 0 ? (
          <div className="relative flex items-center gap-3">
            <div className="h-6 w-6 rounded-full bg-muted border-2 border-white ring-1 ring-border dark:ring-border flex items-center justify-center z-10">
              <Clock className="w-3 h-3 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          </div>
        ) : (
          entries.map((e, idx) => {
            const meta = KIND_META[e.kind] || KIND_META.updated;
            const Icon = meta.Icon;
            const d = e.at ? new Date(e.at) : null;
            const when = d && !Number.isNaN(d.getTime()) ? format(d, "MMM d, h:mm a") : "";
            return (
              <div key={e.id || idx} className="relative group">
                <div className="flex items-start gap-4">
                  <div className="absolute -left-[24px] mt-0.5">
                    <div className="h-6 w-6 rounded-full bg-card border-2 border-border ring-1 ring-border dark:ring-border flex items-center justify-center z-10 shadow-sm">
                      <Icon className={`w-3 h-3 ${meta.color}`} />
                    </div>
                  </div>
                  <div className="flex-1 bg-muted/50 rounded-lg p-3 border border-border">
                    <p className="text-sm font-medium text-foreground">{e.title}</p>
                    {e.outcome && <p className="text-xs font-semibold text-primary mt-0.5">{e.outcome}</p>}
                    {e.note && <p className="text-xs text-muted-foreground mt-0.5">{e.note}</p>}
                    {e.nextStep && <p className="text-xs text-muted-foreground mt-0.5">Next: {e.nextStep}</p>}
                    {e.kind === "lead_created" && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        via {prospect.source}, campaign: {campaign?.name}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">{when}</p>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Origin Marker */}
        <div className="relative flex items-center gap-4">
          <div className="absolute -left-[24px]">
            <div className="h-6 w-6 rounded-full bg-muted border-2 border-white ring-1 ring-border dark:ring-border flex items-center justify-center z-10">
              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
            </div>
          </div>
          <div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Start of History</span>
          </div>
        </div>
      </div>
    </section>
  );
}
