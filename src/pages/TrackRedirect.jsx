import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "@/api/client";

// QR scan landing → hit the backend tracker so it can set attribution cookies
// before the SPA renders the lead-capture form. Use the apiClient base URL
// directly so `/api` substring repeats are not stripped twice (this avoids
// the pre-existing `replace(/\/api\/?$/, '')` quirk: when baseURL is `/api`,
// the old logic produced an empty origin and the call became a same-route
// SPA request rather than hitting the backend).
export default function TrackRedirect() {
  const { slug } = useParams();

  useEffect(() => {
    if (!slug) return;
    const target = `${apiClient.baseURL}/qrcodes/track/${encodeURIComponent(slug)}`;
    window.location.replace(target);
  }, [slug]);

  return null;
}
