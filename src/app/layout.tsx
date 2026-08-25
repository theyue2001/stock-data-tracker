import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Archivo, IBM_Plex_Mono, Noto_Sans_TC } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { MobileNav, MobileNavFallback, SideNav, SideNavFallback } from "@/components/layout/nav";
import { FooterDate } from "@/components/layout/footer-date";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], display: "swap", weight: ["400", "500", "600", "700", "800", "900"] });
const notoTC = Noto_Sans_TC({ variable: "--font-noto-tc", subsets: ["latin"], display: "swap", weight: ["400", "500", "700", "900"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], display: "swap", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "台股產業雷達 · Taiwan Stock Industry Radar",
  description:
    "Investment research dashboard for tracking capital rotation, strengthening industries, and leading indicators across Taiwan-listed equities.",
};

/** The shell forces `.dark`, so declare it: without `colorScheme` a mobile
 *  browser paints its own chrome light and form controls render for a light
 *  page. `themeColor` matches --rd-bg so the address bar continues the app's
 *  own background instead of framing it. */
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#171514",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-Hant"
      className={`dark ${archivo.variable} ${notoTC.variable} ${mono.variable} h-full antialiased`}
      style={{
        // Latin/numeral metrics from Archivo, CJK fallback from Noto Sans TC —
        // matches the handoff's `font-family: Archivo,'Noto Sans TC',sans-serif`.
        ["--font-sans" as string]: "var(--font-archivo), var(--font-noto-tc), system-ui, sans-serif",
        ["--font-mono" as string]: "var(--font-plex-mono), ui-monospace, monospace",
      }}
    >
      <body className="flex min-h-full flex-col bg-[var(--rd-bg)]">
        <div className="flex min-h-screen flex-col lg:flex-row">
          <aside className="sticky top-0 z-20 hidden h-screen w-[200px] shrink-0 flex-col bg-[var(--rd-panel)] lg:flex" style={{ borderRight: "1px solid rgba(243,242,242,.14)" }}>
            <Link href="/" className="block px-4 pt-5 pb-[18px]" style={{ borderBottom: "2px solid var(--rd-rule)" }}>
              <div className="mb-2.5 h-3.5 w-3.5 bg-[var(--rd-accent)]" />
              <div className="text-[16px] leading-tight font-black tracking-[.04em]">台股產業雷達</div>
              <div className="mt-[3px] font-mono text-[8.5px] tracking-[.22em] text-[rgba(243,242,242,.4)]">INDUSTRY RADAR</div>
            </Link>
            <div className="scrollbar-thin flex-1 overflow-y-auto">
              <Suspense fallback={<SideNavFallback />}>
                <SideNav />
              </Suspense>
            </div>
            <div className="px-4 py-3.5 font-mono text-[10px] leading-[1.8] text-[rgba(243,242,242,.45)]" style={{ borderTop: "1px solid rgba(243,242,242,.14)" }}>
              <FooterDate />
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Mobile chrome: the sidebar is hidden below `lg`, so the app's
                identity and its nav have to live here — and stay put while a
                long table scrolls, the way an app's tab bar does. */}
            <div className="sticky top-0 z-30 bg-[var(--rd-panel)] lg:hidden" style={{ borderBottom: "1px solid var(--rd-line)" }}>
              <Link href="/" className="flex items-center gap-2 px-4 py-2.5">
                <span className="h-3 w-3 shrink-0 bg-[var(--rd-accent)]" />
                <span className="text-[14px] leading-none font-black tracking-[.04em]">台股產業雷達</span>
                <span className="ml-auto font-mono text-[8.5px] tracking-[.18em] text-[rgba(243,242,242,.4)]">INDUSTRY RADAR</span>
              </Link>
              <Suspense fallback={<MobileNavFallback />}>
                <MobileNav />
              </Suspense>
            </div>
            <main className="min-w-0 flex-1 bg-[var(--rd-bg)] text-[var(--rd-text)]">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
