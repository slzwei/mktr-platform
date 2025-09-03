import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import CampaignSignupForm from '@/components/campaigns/CampaignSignupForm';
import TypingLoader from '@/components/ui/TypingLoader';
import { CheckCircle, AlertTriangle } from 'lucide-react';

export default function PublicPreview() {
  const { slug } = useParams();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitted, setSubmitted] = useState(false);

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
      if (res.success) setSubmitted(true); else setError(res.message || 'Submission failed');
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
      {design?.imageUrl && (
        <div className="w-full h-56 lg:h-72">
          <img src={resolveImageUrl(design.imageUrl)} alt="Header" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="flex items-center justify-center py-12 px-6">
        <div className="w-full" style={{ maxWidth: `${design.formWidth || 400}px` }}>
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


