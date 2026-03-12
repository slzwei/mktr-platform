import { useState } from "react";
import { apiClient } from "@/api/client";

/**
 * Shared rendering utilities and layout shell for lead capture pages.
 * Used by both LeadCapture.jsx (public) and Preview.jsx (admin preview)
 * to guarantee identical visual output.
 */

export function getBackgroundClass(design) {
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
}

export function getCardClass(design) {
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
}

export function resolveImageUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  const apiOrigin = apiClient.baseURL.replace(/\/?api\/?$/, '');
  return `${apiOrigin}${url.startsWith('/') ? url : '/' + url}`;
}

/**
 * Extracts a YouTube embed URL from various YouTube URL formats.
 * Returns null if the URL is not a YouTube URL.
 */
function getYouTubeEmbedUrl(url) {
  if (!url) return null;
  let videoId = null;

  // youtube.com/watch?v=ID
  const watchMatch = url.match(/(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/);
  if (watchMatch) videoId = watchMatch[1];

  // youtu.be/ID
  if (!videoId) {
    const shortMatch = url.match(/(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (shortMatch) videoId = shortMatch[1];
  }

  // youtube.com/embed/ID
  if (!videoId) {
    const embedMatch = url.match(/(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    if (embedMatch) videoId = embedMatch[1];
  }

  if (!videoId) return null;
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`;
}

/**
 * Media header component — renders image, video (hosted mp4 or YouTube), or nothing.
 */
function MediaHeader({ design }) {
  const mediaType = design?.mediaType || (design?.imageUrl ? 'image' : 'none');
  const [videoError, setVideoError] = useState(false);

  if (mediaType === 'none') return null;

  if (mediaType === 'video' && design?.videoUrl && !videoError) {
    const youtubeUrl = getYouTubeEmbedUrl(design.videoUrl);

    if (youtubeUrl) {
      return (
        <div className="w-full relative bg-black" style={{ aspectRatio: '16/9' }}>
          <iframe
            src={youtubeUrl}
            title="Campaign Video"
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        </div>
      );
    }

    // Hosted mp4 / direct video URL
    return (
      <div className="w-full relative bg-black" style={{ aspectRatio: '16/9' }}>
        <video
          src={resolveImageUrl(design.videoUrl)}
          className="w-full h-full object-cover"
          controls
          playsInline
          preload="metadata"
          onError={() => setVideoError(true)}
        />
      </div>
    );
  }

  // Image (default for backward compat — also handles mediaType === 'image')
  if (design?.imageUrl) {
    return (
      <div className="w-full relative h-48 sm:h-56 bg-gray-100 border-b border-gray-100/50">
        <img
          src={resolveImageUrl(design.imageUrl)}
          alt="Campaign Header"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
      </div>
    );
  }

  return null;
}

/**
 * Shared layout shell for lead capture rendering.
 * Renders background, card, media header (image/video), and children inside the card body.
 *
 * @param {object} props
 * @param {object} props.design - campaign.design_config (or {})
 * @param {number} [props.maxWidth] - optional max-width override in px (Preview uses formWidth)
 * @param {boolean} [props.showTrustFooter] - show the SSL / copyright footer (LeadCapture only)
 * @param {React.ReactNode} props.children - card body content
 */
export default function LeadCaptureLayout({ design = {}, maxWidth, showTrustFooter = false, children }) {
  const background = getBackgroundClass(design);

  return (
    <div
      className={`min-h-screen py-6 px-3 sm:py-8 sm:px-6 lg:px-8 flex flex-col justify-center items-center ${background.className}`}
      style={background.style}
    >
      <div
        className={`w-full max-w-md ${getCardClass(design)}`}
        style={{
          maxWidth: maxWidth ? `${maxWidth}px` : undefined,
          ...(design.cardBackgroundColor ? { backgroundColor: design.cardBackgroundColor } : {})
        }}
      >
        <MediaHeader design={design} />

        <div className="p-5 sm:p-8">
          {children}
        </div>
      </div>

      {showTrustFooter && (
        <div className="mt-6 sm:mt-8 text-center sm:mx-auto sm:w-full sm:max-w-md px-4">
          <div className="flex items-center justify-center gap-4 opacity-60 grayscale transition-all hover:grayscale-0 hover:opacity-100">
            <div className="flex items-center gap-1.5 text-[10px] text-gray-500 font-medium bg-white/50 backdrop-blur-sm px-2 py-1 rounded-full border border-gray-100">
              <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              SSL Secure Connection
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-4">
            &copy; {new Date().getFullYear()} MKTR Platform. All rights reserved. <br />
            By submitting this form, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      )}
    </div>
  );
}
