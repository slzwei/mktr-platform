import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import CampaignSignupForm from '@/components/campaigns/CampaignSignupForm';
import TypingLoader from '@/components/ui/TypingLoader';
import CheckCircle from 'lucide-react/icons/check-circle';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';


const getBackgroundClass = (design) => {
  if (!design) return { className: 'bg-gray-50', style: {} };

  const type = design.backgroundType || 'preset'; // 'preset' | 'custom'

  if (type === 'custom') {
    return {
      className: '', // No specific class, rely on style
      style: { backgroundColor: design.backgroundColor || '#f9fafb' }
    };
  }

  // Backwards compatibility for existing designs
  const style = design.backgroundStyle || 'gradient';

  switch (style) {
    case 'gradient': // Modern default
      return { className: 'bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-50 via-white to-gray-50', style: {} };
    case 'solid_slate': // Corporate
      return { className: 'bg-slate-50', style: {} };
    case 'simple_gray': // Simple
      return { className: 'bg-white', style: {} };
    case 'solid': // Legacy
      return { className: 'bg-gray-50', style: {} };
    case 'pattern': // Legacy
      return { className: 'bg-gray-50 bg-[url("https://www.transparenttextures.com/patterns/cubes.png")]', style: {} };
    default:
      return { className: 'bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-50 via-gray-50 to-gray-100', style: {} };
  }
};

const getCardClass = (design) => {
  // If specific template is selected, enforce its card style
  // Otherwise default to modern rounded
  const template = design?.layoutTemplate || 'modern';

  switch (template) {
    case 'corporate':
      return 'bg-white shadow-md border border-gray-200 rounded-lg overflow-hidden';
    case 'simple':
      return 'bg-transparent border-none shadow-none rounded-none overflow-visible';
    case 'modern':
    default:
      return 'bg-white/80 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/50 rounded-3xl overflow-hidden';
  }
};

export default function PublicPreview() {
  const { slug } = useParams();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shortening, setShortening] = useState(false);
  const [shortShareUrl, setShortShareUrl] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const res = await apiClient.get(`/previews/slug/${slug}`);
        if (mounted) setSnapshot(res.data?.snapshot || null);
      } catch (e) {
        setError('Preview not found or expired.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false };
  }, [slug]);

  const design = useMemo(() => snapshot?.design_config || {}, [snapshot]);

  const longShareUrl = useMemo(() => window.location.href, []);

  useEffect(() => {
    (async () => {
      if (shareOpen) {
        setShortening(true);
        try {
          const resp = await apiClient.post('/shortlinks', { targetUrl: longShareUrl, campaignId: snapshot?.id, purpose: 'share', ttlDays: 90 });
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
  }, [shareOpen, longShareUrl, snapshot]);

  const resolveImageUrl = (url) => {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    const apiOrigin = apiClient.baseURL.replace(/\/?api\/?$/, '');
    return `${apiOrigin}${url.startsWith('/') ? url : '/' + url}`;
  };

  // Ensure preview pages are not indexed
  useEffect(() => {
    const meta = document.querySelector('meta[name="robots"]') || document.createElement('meta');
    meta.setAttribute('name', 'robots');
    meta.setAttribute('content', 'noindex,nofollow');
    if (!meta.parentElement) document.head.appendChild(meta);
  }, []);

  const handleSubmit = async (formData) => {
    try {
      const body = {
        firstName: (formData.name || '').split(' ').slice(0, -1).join(' ') || formData.name || '',
        lastName: (formData.name || '').split(' ').slice(-1).join(' ') || '',
        email: formData.email,
        phone: formData.phone,
        leadSource: 'website',
        campaignId: snapshot?.id
      };
      const res = await apiClient.post('/prospects', body);
      if (res.success) { setSubmitted(true); setShareOpen(true); } else setError(res.message || 'Submission failed');
    } catch (e) {
      setError(e.message || 'Submission failed');
    }
  };

  if (loading) return <TypingLoader />;

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="bg-white p-8 rounded-lg shadow-xl text-center border">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900">An Error Occurred</h2>
          <p className="text-gray-600 mt-2">{error}</p>
        </div>
      </div>
    );
  }

  const background = getBackgroundClass(design);

  return (
    <div className={`min-h-screen ${background.className}`} style={background.style}>
      {/* Title update */}
      <Title title={`Preview • ${snapshot?.name || 'Campaign'}`} />
      <div className="flex items-center justify-center py-12 px-6">
        <div
          className={`w-full ${getCardClass(design)}`}
          style={{
            maxWidth: `${design.formWidth || 400}px`,
            ...(design.cardBackgroundColor ? { backgroundColor: design.cardBackgroundColor } : {})
          }}
        >
          {design?.imageUrl && (
            <div className="w-full relative h-48 sm:h-56 bg-gray-100 border-b border-gray-100/50">
              <img
                src={resolveImageUrl(design.imageUrl)}
                alt="Campaign Header"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
            </div>
          )}

          <div className="p-6 sm:p-8">
            {submitted ? (
              <div className="text-center py-8">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mb-4 animate-in zoom-in duration-300">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Thank You!</h2>
                <p className="text-gray-600">Your submission has been received.</p>
              </div>
            ) : (
              <CampaignSignupForm
                themeColor={design.themeColor || '#3B82F6'}
                formHeadline={design.formHeadline || 'Sign Up Now'}
                formSubheadline={design.formSubheadline || 'Fill out the form to get started.'}
                headlineSize={design.headlineSize || 20}
                campaignId={snapshot?.id}
                onSubmit={handleSubmit}
                campaign={{ ...snapshot, design_config: design, min_age: snapshot?.min_age, max_age: snapshot?.max_age }}
                alignment={design.alignment}
                textColor={design.textColor}
              />
            )}
          </div>
          <Dialog open={shareOpen} onOpenChange={setShareOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{`Share ${snapshot?.name || 'this campaign'} with your friends and family`}</DialogTitle>
                <DialogDescription>Invite friends and family to participate.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="p-3 bg-gray-50 rounded-lg border flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-[11px] sm:text-sm break-all text-gray-800 leading-snug">
                      {shortening ? 'Generating short link…' : (shortShareUrl || longShareUrl)}
                    </div>
                    {shortShareUrl && (
                      <div className="text-[10px] text-gray-500 mt-1">Shortened for sharing</div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const url = shortShareUrl || longShareUrl;
                      try { await navigator.clipboard.writeText(url); } catch (_) { }
                    }}
                  >
                    Copy Link
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Button
                    onClick={() => {
                      const url = shortShareUrl || longShareUrl;
                      const text = snapshot?.name ? `Join me in ${snapshot.name}! ${url}` : `Check this out: ${url}`;
                      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                    }}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    Share on WhatsApp
                  </Button>
                  <Button
                    onClick={() => {
                      const url = shortShareUrl || longShareUrl;
                      const text = snapshot?.name ? `Join me in ${snapshot.name}!` : 'Check this out:';
                      window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank');
                    }}
                    className="bg-blue-500 hover:bg-blue-600 text-white"
                  >
                    Share on Telegram
                  </Button>
                  <Button variant="secondary" onClick={() => setShareOpen(false)}>Close</Button>
                </div>
              </div>
              <DialogFooter />
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}

function Title({ title }) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev; };
  }, [title]);
  return null;
}


