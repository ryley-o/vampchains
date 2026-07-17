import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";
import { ConnectButton } from "@/components/ConnectButton";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "vampchains",
  description: "Pick a token, pay a fee, get your own meme sidechain.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100">
        <Providers>
          <header className="border-b border-neutral-800">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
              <Link href="/" className="text-lg font-bold tracking-tight">
                🧛 vamp<span className="text-red-500">chains</span>
              </Link>
              <nav className="flex items-center gap-4 text-sm">
                <Link href="/create" className="hover:text-red-400">
                  Create a chain
                </Link>
                <Link href="/terms" className="text-neutral-400 hover:text-neutral-200">
                  Terms
                </Link>
                <ConnectButton />
              </nav>
            </div>
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
          <footer className="border-t border-neutral-800 px-4 py-6 text-center text-xs text-neutral-500">
            Unaudited, experimental, single-relayer bridge trust model. Read the{" "}
            <Link href="/terms" className="underline">
              terms
            </Link>{" "}
            before you send anything real value.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
