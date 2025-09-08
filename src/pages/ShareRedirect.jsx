import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "@/api/client";

export default function ShareRedirect() {
  const { slug } = useParams();

  useEffect(() => {
    if (slug) {
      const backendOrigin = apiClient.baseURL.replace(/\/api\/?$/, "");
      const target = `${backendOrigin}/share/${encodeURIComponent(slug)}`;
      window.location.replace(target);
    }
  }, [slug]);

  return null;
}


