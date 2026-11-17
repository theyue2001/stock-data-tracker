import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, PageShell } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_ADMIN_PATH, adminAuthMode, safeAdminPath } from "@/lib/health/admin-auth";

export const metadata = { title: "管理登入 · 台股產業雷達" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * A plain HTML form posting to /api/admin/login — no client JavaScript, so
 * the token never passes through React state and the form works with
 * scripts disabled.
 */
export default function AdminLoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageShell maxWidth={480}>
      <PageHeader title="管理登入" note="ADMIN" subtitle="輸入管理權杖（ADMIN_TOKEN）後檢視資料健康頁。" />
      <Suspense fallback={<LoginForm next={DEFAULT_ADMIN_PATH} />}>
        <LoginBody searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function LoginBody({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = safeAdminPath(first(sp.next));
  // Read after the request-time searchParams, so the env is checked per
  // request rather than baked in at build time.
  if (adminAuthMode().mode === "open-dev") {
    return (
      <div className="rd-card rd-card-body text-[12px] leading-[1.7] text-[var(--rd-text-secondary)]">
        開發環境未設定 ADMIN_TOKEN，不需要登入。
        <Link href={next} className="ml-1 font-semibold">
          前往資料健康頁 →
        </Link>
      </div>
    );
  }
  return <LoginForm next={next} error={first(sp.error) === "1"} signedOut={first(sp.signed_out) === "1"} />;
}

function LoginForm({ next, error, signedOut }: { next: string; error?: boolean; signedOut?: boolean }) {
  return (
    <form method="post" action="/api/admin/login" className="rd-card rd-card-body flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      {signedOut && <p className="text-[11.5px] text-[var(--rd-text-secondary)]">已登出。</p>}
      <label htmlFor="admin-token" className="text-[11px] font-medium text-[var(--rd-text-secondary)]">
        管理權杖
      </label>
      <Input
        id="admin-token"
        name="token"
        type="password"
        required
        autoFocus
        autoComplete="current-password"
        aria-invalid={error || undefined}
        aria-describedby={error ? "admin-token-error" : undefined}
      />
      {error && (
        <p id="admin-token-error" role="alert" className="text-[11.5px] font-semibold text-[var(--rd-warn-word)]">
          ! 權杖不正確，請再試一次。
        </p>
      )}
      <Button type="submit" className="self-start px-4">
        登入
      </Button>
    </form>
  );
}
