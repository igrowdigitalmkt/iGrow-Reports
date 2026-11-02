import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://groowads.com/", changeFrequency: "weekly", priority: 1 },
    { url: "https://groowads.com/termos", changeFrequency: "yearly", priority: 0.3 },
    { url: "https://groowads.com/privacidade", changeFrequency: "yearly", priority: 0.3 },
  ];
}
