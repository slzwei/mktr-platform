import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "@/api/client";

// Hit the backend shortlink resolver via the API mount (/api/shortlinks/:slug)
// so the request goes through the static-site /api/* proxy. The historical
// `${backendOrigin}/share/:slug` path is the SAME route the SPA mounts at,
// which loops infinitely whenever VITE_API_URL is set to a same-origin
// `/api` (e.g. on redeem.sg or any Render proxy setup).
export default function ShareRedirect() {
  const { slug } = useParams();

  useEffect(() => {
    if (!slug) return;
    const target = `${apiClient.baseURL}/shortlinks/${encodeURIComponent(slug)}`;
    window.location.replace(target);
  }, [slug]);

  return null;
}
