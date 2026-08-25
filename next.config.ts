import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen reads the same batch-computed dataset, refreshed once a day by
  // the 20:00 Asia/Taipei cron. Cache Components lets those reads be cached
  // (`"use cache"` in src/lib/queries.ts and src/lib/sentiment-queries.ts) so
  // the pages prerender instead of paying ~1-2s of Neon round trips on every
  // navigation. The daily job invalidates them with revalidateTag().
  cacheComponents: true,
};

export default nextConfig;
