import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PdP-DGO-Dashboard-Financiero",
    short_name: "PdP-DGO",
    description:
      "Dashboard financiero de reconciliación de pagos - Presidencia de Pagos DGO",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#10b981",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
