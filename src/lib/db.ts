import { PrismaClient } from "@/generated/prisma";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Prisma 的 connection pool 預設 `connection_limit = cpu 數 * 2 + 1`，Vercel 的
 * build container 只有 1 顆 CPU，等於全 build 只有 3 條連線；prerender 又會平行
 * 跑多個 /industries/[slug]，每頁一組巨大的 nested query，排隊超過預設 10s 的
 * pool_timeout 就會噴 P2024 讓 build 直接失敗。
 *
 * DATABASE_URL 指向 Neon 的 PgBouncer pooled endpoint（見 prisma/schema.prisma），
 * 上游本來就能吃下數百條連線，所以在這裡把上限與等待時間拉高是安全的。URL 上若
 * 已自帶參數則以既有值為準，方便之後在 Vercel 環境變數層覆寫。
 */
function withPoolParams(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("connection_limit")) {
      parsed.searchParams.set("connection_limit", "10");
    }
    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", "30");
    }
    return parsed.toString();
  } catch {
    // 非標準格式的連線字串就原封不動交給 Prisma 自己判斷。
    return url;
  }
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: withPoolParams(process.env.DATABASE_URL),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
