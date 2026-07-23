import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { HeaderSearch } from "@/components/HeaderSearch";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://scan.vampchain.com"),
  title: "Vampchain Scan",
  description: "A block explorer for every vampchain — blocks, transactions, addresses, verified contracts.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-ink text-bone">
        <header className="sticky top-0 z-40 border-b border-hairline bg-ink/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-display text-[17px] text-bone">
                vamp<span className="text-blood">scan</span>
              </span>
            </Link>
            <div className="w-full sm:w-auto sm:flex-1 sm:max-w-md">
              <HeaderSearch />
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-hairline">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-8 text-xs text-bone-dim/50 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-mono uppercase tracking-wider">Vampscan · read-only, no indexer</span>
            <p>
              Blocks/txs are read live from each chain&apos;s own node, not indexed — a torn-down chain&apos;s
              history is unrecoverable.{" "}
              <a href="https://www.vampchain.com" className="underline underline-offset-2 hover:text-bone-dim">
                vampchain.com
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
