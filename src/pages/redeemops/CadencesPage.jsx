import CadenceStudio from '@/components/redeemops/CadenceStudio';
import { RoPageHeader } from '@/components/redeemops/ui';

/**
 * /redeem-ops/cadences — the authoring home for everyone with tasks.manage
 * (BDMs and outreach execs, not just settings admins). Admins keep their
 * embed on Settings; both render the same CadenceStudio, whose row actions
 * are scoped to creator-or-admin exactly like the service's canAuthorRow.
 */
export default function CadencesPage() {
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <RoPageHeader
        title="Cadences"
        sub="Build the outreach sequences your team enrolls businesses into. New ones can stay private drafts until you publish; only a cadence's creator or an admin can change it."
      />
      <CadenceStudio />
    </div>
  );
}
