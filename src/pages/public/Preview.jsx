import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import CampaignSignupForm from '@/components/campaigns/CampaignSignupForm';
import TypingLoader from '@/components/ui/TypingLoader';
import CheckCircle from 'lucide-react/icons/check-circle';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

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
    const shortenUrl = async (url) => {
      try {
        const r1 = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
        if (r1.ok) {
          const t = (await r1.text()).trim();
          if (/^https?:\/\//i.test(t)) return t;
        }
      } catch(_) {}
      try {
        const r2 = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
        if (r2.ok) {
          const t = (await r2.text()).trim();
          if (/^https?:\/\//i.test(t)) return t;
        }
      } catch(_) {}
      return null;
    };

    (async () => {
      if (shareOpen) {
        setShortening(true);
        const s = await shortenUrl(longShareUrl);
        setShortShareUrl(s || '');
        setShortening(false);
      } else {
        setShortShareUrl('');
      }
    })();
  }, [shareOpen, longShareUrl]);

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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Title update */}
      <Title title={`Preview • ${snapshot?.name || 'Campaign'}`} />
      <div className="flex items-center justify-center py-12 px-6">
        <div className="w-full" style={{ maxWidth: `${design.formWidth || 400}px` }}>
          {design?.imageUrl && (
            <div className="w-full h-56 lg:h-72 mb-6">
              <img src={resolveImageUrl(design.imageUrl)} alt="Header" className="w-full h-full object-contain rounded-md" />
            </div>
          )}
          {submitted ? (
            <div className="bg-white p-8 rounded-lg shadow-xl text-center border">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900">Thank You!</h2>
              <p className="text-gray-600 mt-2">Your submission has been received.</p>
            </div>
          ) : (
            <CampaignSignupForm
              themeColor={design.themeColor || '#3B82F6'}
              formHeadline={design.formHeadline || 'Sign Up Now'}
              formSubheadline={design.formSubheadline || 'Fill out the form to get started.'}
              headlineSize={design.headlineSize || 20}
              campaignId={snapshot?.id}
              onSubmit={handleSubmit}
              campaign={{ min_age: snapshot?.min_age, max_age: snapshot?.max_age }}
            />
          )}
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
                      try { await navigator.clipboard.writeText(url); } catch (_) {}
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
                      window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}` , '_blank');
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


