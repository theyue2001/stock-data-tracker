"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "總覽" },
  { href: "/industries", label: "產業雷達" },
  { href: "/capital-flow", label: "資金流向" },
  { href: "/stocks", label: "個股雷達" },
  { href: "/indicators", label: "領先指標" },
  { href: "/daily-brief", label: "每日簡報" },
  { href: "/watchlist", label: "追蹤清單" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col py-2.5">
      {NAV_ITEMS.map((item, i) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center px-4 py-2.5 text-[13px] transition-colors",
              active
                ? "bg-[var(--rd-accent)] font-bold text-[var(--rd-bg)]"
                : "font-medium text-[rgba(243,242,242,.72)] hover:bg-[var(--rd-hover)]",
            )}
          >
            <span>{item.label}</span>
            <span className="ml-auto font-mono text-[9px] tracking-wide opacity-45">0{i + 1}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-[var(--rd-line)] bg-[var(--rd-panel)] px-2 py-1.5 lg:hidden">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "shrink-0 rounded-none px-2.5 py-1 text-[11px] font-medium whitespace-nowrap",
              active ? "bg-[var(--rd-accent)] text-[var(--rd-bg)]" : "text-[rgba(243,242,242,.65)]",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
