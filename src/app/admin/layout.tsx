import type { Metadata } from "next";
import type { ReactNode } from "react";

/** The proxy also sends `X-Robots-Tag: noindex`; the meta tag covers a page
 *  served from a cache or saved and opened elsewhere. */
export const metadata: Metadata = {
  title: "管理 · 台股產業雷達",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
