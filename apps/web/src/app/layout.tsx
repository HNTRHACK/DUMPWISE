import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Open-source (SIL OFL) fonts, downloaded at build time and self-hosted by next/font:
// no request to Google at runtime, no layout shift (size-adjusted fallbacks).
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["opsz", "SOFT"],
  display: "swap",
});
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "DUMPWISE — Your data has a story. We make it speak.", template: "%s · DUMPWISE" },
  description:
    "Turn fragmented SAP exports into reconciled intelligence, meaningful forecasts and confident decisions.",
};

export const viewport: Viewport = {
  themeColor: "#110B08",
  colorScheme: "dark light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
