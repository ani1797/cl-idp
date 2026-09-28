import type { Metadata } from "next";
import localFont from "next/font/local";
import { Public_Sans, Source_Sans_3 } from "next/font/google";

import { AppShell } from "@/components/app-shell";
import { AppProviders } from "@/components/providers/app-providers";

import "./globals.css";

/** Headlines and labels. */
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  display: "swap",
});

/** Body and dense table UI — matches canadalife.com's production body font. */
const sourceSans = Source_Sans_3({
  variable: "--font-source-sans-3",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Material Symbols is not in next/font/google's catalogue, so the static
 * instance (opsz 24, wght 400, FILL 0, GRAD 0) is self-hosted instead. This
 * keeps icons on a first-party request with no flash of unstyled text.
 */
const materialSymbols = localFont({
  src: "./fonts/material-symbols-outlined.woff2",
  variable: "--font-material-symbols",
  display: "block",
  weight: "400",
  style: "normal",
});

export const metadata: Metadata = {
  title: "Canada Life IDP",
  description: "Intelligent Document Processing platform",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${sourceSans.variable} ${materialSymbols.variable} h-full antialiased`}
    >
      <body className="bg-background min-h-full">
        <AppProviders>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
