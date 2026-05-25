import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://scholarpulse.example";
  const now = new Date();

  return [
    { url: `${baseUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/search`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/feed`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${baseUrl}/library`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${baseUrl}/topics/machine%20learning`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${baseUrl}/authors/geoffrey%20hinton`, lastModified: now, changeFrequency: "weekly", priority: 0.6 }
  ];
}
