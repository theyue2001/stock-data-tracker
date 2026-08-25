"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "總覽" },
  { href: "/industries", label: "產業雷達" },
  { href: "/momentum", label: "產業氣氛" },
  { href: "/capital-flow", label: "資金流向" },
  { href: "/stocks", label: "個股雷達" },
  { href: "/indicators", label: "領先指標" },
  { href: "/daily-brief", label: "每日簡報" },
  { href: "/watchlist", label: "追蹤清單" },
];

function isActive(pathname: string | null, href: string) {
  if (pathname === null) return false;
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Click feedback for a nav link. Must be rendered inside the <Link> — that is
 * how useLinkStatus() finds the transition it belongs to. The dot is styled to
 * stay invisible for the first 100ms, so a normal (prefetched, instant)
 * transition shows nothing at all and only a genuinely slow one gets a hint.
 */
function LinkHint() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={cn("rd-link-hint", pending && "is-pending")} />;
}

// ---------------------------------------------------------------------------
// Presentation. Split from the pathname lookup so the same markup can render
// both inside the Suspense boundary (with the highlight) and as its fallback
// (`pathname === null`, nothing highlighted) — see the note on SideNav.
// ---------------------------------------------------------------------------

function SideNavList({ pathname }: { pathname: string | null }) {
  return (
    <nav className="flex flex-col py-2.5">
      {NAV_ITEMS.map((item, i) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center px-4 py-2.5 text-[13px] transition-colors",
              active
                ? "bg-[var(--rd-accent)] font-bold text-[var(--rd-bg)]"
                : "font-medium text-[rgba(243,242,242,.72)] hover:bg-[var(--rd-hover)]",
            )}
          >
            <span>{item.label}</span>
            <LinkHint />
            <span className="ml-auto font-mono text-[9px] tracking-wide opacity-45">0{i + 1}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function MobileNavList({ pathname }: { pathname: string | null }) {
  return (
    <nav
      className="rd-scroll-x scrollbar-thin flex gap-1 px-2 pb-1.5"
      style={{ borderTop: "1px solid var(--rd-line)", paddingTop: 6 }}
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center rounded-none px-3 py-1.5 text-[12px] font-medium whitespace-nowrap",
              active ? "bg-[var(--rd-accent)] font-bold text-[var(--rd-bg)]" : "text-[rgba(243,242,242,.65)]",
            )}
          >
            {item.label}
            <LinkHint />
          </Link>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// The pathname-aware wrappers.
//
// `usePathname()` reads URL data, which Cache Components cannot resolve while
// prerendering — left unguarded in the root layout it blocks the static shell
// of EVERY route, which is exactly what makes the sidebar links feel slow. So
// the layout renders these inside <Suspense fallback={<...Fallback />}>: the
// shell ships the full link list with nothing highlighted, and the highlight
// resolves on top of it. Client navigations are unaffected — the router
// already knows the URL, so the hook resolves synchronously and the highlight
// moves the instant a link is clicked.
// ---------------------------------------------------------------------------

export function SideNav() {
  return <SideNavList pathname={usePathname()} />;
}

export function SideNavFallback() {
  return <SideNavList pathname={null} />;
}

export function MobileNav() {
  return <MobileNavList pathname={usePathname()} />;
}

export function MobileNavFallback() {
  return <MobileNavList pathname={null} />;
}
