import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, Pause } from 'lucide-react';
import CampaignReadinessBanner from '@/components/campaigns/CampaignReadinessBanner';

/**
 * Launch tab — reuses the existing readiness banner and adds activate/pause.
 * The backend readiness-gates activation (409 with issues) unless forced; the
 * workspace surfaces that as a toast.
 */
export default function CampaignLaunchTab({ campaign, onSetState, saving }) {
  const isActive = campaign?.status === 'active' || campaign?.is_active === true;

  return (
    <div className="space-y-6 max-w-3xl">
      <CampaignReadinessBanner campaignId={campaign.id} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Launch status
            <Badge className={isActive ? 'bg-success/15 text-success' : 'bg-muted text-foreground'}>
              {campaign?.status || (isActive ? 'active' : 'draft')}
            </Badge>
          </CardTitle>
          <CardDescription>
            Activating makes this campaign live and starts routing leads to your funded agents. We&apos;ll
            warn you if it isn&apos;t ready.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button onClick={() => onSetState('active')} disabled={saving || isActive}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Activate
          </Button>
          <Button variant="outline" onClick={() => onSetState('paused')} disabled={saving || !isActive}>
            <Pause className="w-4 h-4 mr-2" /> Pause
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
