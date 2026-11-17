import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen reads the same batch-computed dataset, written by the
  // after-hours pipeline once the exchange publishes each session (polled every
  // 5 minutes from 13:30 Asia/Taipei). Cache Components lets those reads be
  // cached (`"use cache"` in src/lib/queries.ts and src/lib/sentiment-queries.ts)
  // so the pages prerender instead of paying ~1-2s of Neon round trips on every
  // navigation. The jobs expire them immediately with
  // revalidateTag(tag, { expire: 0 }) after writing.
  cacheComponents: true,
  experimental: {
    // build 時每個 /industries/[slug] 都會打一組很重的 nested query，預設一個
    // worker 併發 8 頁會把 Prisma connection pool 塞爆（P2024）。搭配
    // src/lib/db.ts 拉高的 connection_limit，把併發壓到 4 讓峰值連線數留有餘裕。
    staticGenerationMaxConcurrency: 4,
  },
};

export default nextConfig;
