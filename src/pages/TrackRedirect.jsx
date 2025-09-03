import { useEffect } from "react";
import { useParams } from "react-router-dom";

export default function TrackRedirect() {
  const { slug } = useParams();

  useEffect(() => {
    if (slug) {
      const target = `/api/qrcodes/track/${encodeURIComponent(slug)}`;
      window.location.replace(target);
    }
  }, [slug]);

  return null;
}


