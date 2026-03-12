import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import CheckCircle from 'lucide-react/icons/check-circle';
import { apiClient } from '@/api/client';

/**
 * Reusable share dialog for campaigns.
 *
 * Props:
 *  - open / onOpenChange  – dialog visibility
 *  - campaignName          – display name used in share text
 *  - campaignId            – used when generating shortlink
 *  - longShareUrl          – fallback URL when shortening fails or is pending
 */
export default function ShareCampaignDialog({ open, onOpenChange, campaignName, campaignId, longShareUrl }) {
  const [shortening, setShortening] = useState(false);
  const [shortShareUrl, setShortShareUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // Generate a shortlink each time the dialog opens
  useEffect(() => {
    (async () => {
      if (open) {
        setShortening(true);
        try {
          const resp = await apiClient.post('/shortlinks', {
            targetUrl: longShareUrl,
            campaignId,
            purpose: 'share',
            ttlDays: 90,
          }, { skipAuth: true });
          const url = resp?.data?.url;
          const absolute = url?.startsWith('http') ? url : `${window.location.origin}${url}`;
          setShortShareUrl(absolute || '');
        } catch (_) {
          setShortShareUrl('');
        }
        setShortening(false);
      } else {
        setShortShareUrl('');
      }
    })();
  }, [open, longShareUrl, campaignId]);

  const shareUrl = shortShareUrl || longShareUrl;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setCopied(false);
      }}
    >
      <DialogContent className="sm:max-w-md rounded-2xl overflow-hidden border-0 shadow-2xl">
        <DialogHeader className="bg-gray-50 p-6 border-b border-gray-100">
          <DialogTitle className="text-xl font-bold text-center">
            Invite Others
          </DialogTitle>
          <DialogDescription className="text-center text-gray-500 mt-1.5">
            Use the link below to share "{campaignName}" with friends.
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-6">
          {/* Link display + copy */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/60 flex items-center gap-3 shadow-inner">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">
                {shortening ? 'Creating link...' : shareUrl}
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">Unique referral link</div>
            </div>
            <Button
              size="sm"
              variant={copied ? 'default' : 'secondary'}
              className={`shrink-0 transition-all ${copied ? 'bg-green-600 hover:bg-green-700 text-white shadow-md' : 'shadow-sm text-gray-700 bg-white hover:bg-gray-50 border border-gray-200'}`}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch (_) { }
              }}
            >
              {copied ? <CheckCircle className="w-3.5 h-3.5 mr-1" /> : null}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          {/* Social share buttons */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={() => {
                const text = campaignName
                  ? `Join me in ${campaignName}! ${shareUrl}`
                  : `Check this out: ${shareUrl}`;
                window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
              }}
              className="bg-[#25D366] hover:bg-[#20bd5a] text-white border-0 shadow-md transition-transform active:scale-95"
            >
              <img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/whatsapp.svg" alt="" className="w-4 h-4 invert mr-2" />
              WhatsApp
            </Button>
            <Button
              onClick={() => {
                const text = campaignName
                  ? `Join me in ${campaignName}!`
                  : 'Check this out:';
                window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`, '_blank');
              }}
              className="bg-[#229ED9] hover:bg-[#1f8dbf] text-white border-0 shadow-md transition-transform active:scale-95"
            >
              <img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/telegram.svg" alt="" className="w-4 h-4 invert mr-2" />
              Telegram
            </Button>
          </div>
        </div>

        <DialogFooter className="p-4 bg-gray-50 border-t border-gray-100 flex justify-center sm:justify-center">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="text-gray-500 hover:text-gray-900">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
