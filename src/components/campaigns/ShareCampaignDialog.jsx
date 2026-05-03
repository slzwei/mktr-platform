import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import CheckCircle from 'lucide-react/icons/check-circle';
import X from 'lucide-react/icons/x';
import { apiClient } from '@/api/client';

/**
 * Reusable share dialog for campaigns.
 * Renders as a mobile-friendly bottom sheet overlay (no Radix dialog).
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
 const resp = await apiClient.post(
 '/shortlinks/public/share',
 {
 targetUrl: longShareUrl,
 campaignId,
 },
 { skipAuth: true }
 );
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

 // Lock body scroll when open
 useEffect(() => {
 if (open) {
 document.body.style.overflow = 'hidden';
 } else {
 document.body.style.overflow = '';
 }
 return () => {
 document.body.style.overflow = '';
 };
 }, [open]);

 const shareUrl = shortShareUrl || longShareUrl;

 if (!open) return null;

 const close = () => {
 onOpenChange(false);
 setCopied(false);
 };

 return (
 <div role="dialog" aria-modal="true" aria-label="Share campaign" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
 {/* Backdrop */}
 <button type="button" aria-label="Close share dialog" className="absolute inset-0 bg-foreground/60 cursor-default" onClick={close} />

 {/* Sheet */}
 <div className="relative z-10 w-full sm:max-w-sm bg-card rounded-t-2xl sm:rounded-2xl shadow-2xl animate-in slide-in-from-bottom duration-200 max-h-[85vh] overflow-y-auto">
 {/* Header */}
 <div className="flex items-center justify-between px-5 pt-5 pb-3">
 <div className="flex-1">
 <h2 className="text-lg font-bold text-foreground">Invite Friends</h2>
 <p className="text-sm text-muted-foreground mt-0.5">Share"{campaignName}"with others.</p>
 </div>
 <button onClick={close} className="ml-3 p-1.5 rounded-full hover:bg-muted text-muted-foreground">
 <X className="w-5 h-5"/>
 </button>
 </div>

 {/* Body */}
 <div className="px-5 pb-4 space-y-4">
 {/* Link display + copy */}
 <div className="bg-muted rounded-xl p-3 border border-border/60 flex items-center gap-2">
 <div className="flex-1 min-w-0">
 <div className="text-xs font-medium text-foreground truncate">
 {shortening ? 'Creating link...' : shareUrl}
 </div>
 <div className="text-[10px] text-muted-foreground mt-0.5">Your unique referral link</div>
 </div>
 <Button
 size="sm" variant={copied ? 'default' : 'secondary'}
 className={`shrink-0 text-xs px-3 ${copied ? 'bg-success hover:bg-success/90 text-background' : 'bg-card border border-border text-foreground'}`}
 onClick={async () => {
 try {
 await navigator.clipboard.writeText(shareUrl);
 setCopied(true);
 setTimeout(() => setCopied(false), 2000);
 } catch {
 /* clipboard not available */
 }
 }}
 >
 {copied ? <CheckCircle className="w-3.5 h-3.5 mr-1"/> : null}
 {copied ? 'Copied' : 'Copy'}
 </Button>
 </div>

 {/* Social share buttons */}
 <div className="grid grid-cols-2 gap-3">
 <Button
 onClick={() => {
 const text = campaignName ? `Join me in ${campaignName}! ${shareUrl}` : `Check this out: ${shareUrl}`;
 window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
 }}
 className="bg-[#25D366] hover:bg-[#20bd5a] text-background border-0 shadow-md active:scale-95 h-11" >
 <img
 src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/whatsapp.svg" alt="" className="w-4 h-4 invert mr-2" />
 WhatsApp
 </Button>
 <Button
 onClick={() => {
 const text = campaignName ? `Join me in ${campaignName}!` : 'Check this out:';
 window.open(
 `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`,
 '_blank'
 );
 }}
 className="bg-[#229ED9] hover:bg-[#1f8dbf] text-background border-0 shadow-md active:scale-95 h-11" >
 <img
 src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/telegram.svg" alt="" className="w-4 h-4 invert mr-2" />
 Telegram
 </Button>
 </div>
 </div>

 {/* Safe area padding for phones with gesture bars */}
 <div className="h-2 sm:h-0"/>
 </div>
 </div>
 );
}
