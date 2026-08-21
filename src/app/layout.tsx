import type { Metadata } from "next";
import Link from "next/link";
import { Archivo, IBM_Plex_Mono, Noto_Sans_TC } from "next/font/google";
import "./globals.css";
import { MobileNav, SideNav } from "@/components/layout/nav";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], display: "swap", weight: ["400", "500", "600", "700", "800", "900"] });
const notoTC = Noto_Sans_TC({ variable: "--font-noto-tc", subsets: ["latin"], display: "swap", weight: ["400", "500", "700", "900"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], display: "swap", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "台股產業雷達 · Taiwan Stock Industry Radar",
  description:
    "Investment research dashboard for tracking capital rotation, strengthening industries, and leading indicators across Taiwan-listed equities.",
};

function todayFooterLabel(): { date: string; day: string } {
  const now = new Date();
  const date = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  const day = now.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  return { date, day };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  const { date, day } = todayFooterLabel();

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
              <SideNav />
            </div>
            <div className="px-4 py-3.5 font-mono text-[10px] leading-[1.8] text-[rgba(243,242,242,.45)]" style={{ borderTop: "1px solid rgba(243,242,242,.14)" }}>
              {date} {day}
              <br />
              收盤資料 · 20:00 更新
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <MobileNav />
            <main className="min-w-0 flex-1 bg-[var(--rd-bg)] text-[var(--rd-text)]">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
