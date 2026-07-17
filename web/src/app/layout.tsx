import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";
import { ConnectButton } from "@/components/ConnectButton";
import { Logo } from "@/components/brand/Logo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://vampchain.com"),
  title: "Vampchain — turn any token into its own chain",
  description:
    "Pick an existing ERC20. Pay an annual fee. Get a single-node EVM sidechain that uses your token as native gas. The chain is the meme.",
  icons: { icon: "/brand/favicon.svg" },
  openGraph: {
    title: "Vampchain",
    description: "It vampires tokens. Turn any ERC20 into its own chain.",
    images: ["/brand/social-avatar.svg"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-ink text-bone">
        <Providers>
          <header className="sticky top-0 z-40 border-b border-hairline bg-ink/85 backdrop-blur-md">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
              <Link href="/" className="group flex items-center gap-2.5">
                <Logo className="h-6 w-6 text-bone transition-transform duration-300 group-hover:scale-110" />
                <span className="text-display text-[17px] text-bone">
                  vamp<span className="text-blood">chain</span>
                </span>
              </Link>
              <nav className="flex items-center gap-6 text-sm">
                <Link
                  href="/create"
                  className="hidden font-medium text-bone-dim transition-colors hover:text-bone sm:inline"
                >
                  Create a chain
                </Link>
                <Link
                  href="/terms"
                  className="hidden font-medium text-bone-dim/60 transition-colors hover:text-bone-dim sm:inline"
                >
                  Terms
                </Link>
                <ConnectButton />
              </nav>
            </div>
          </header>

          <main className="flex-1">{children}</main>

          <footer className="border-t border-hairline">
            <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-xs text-bone-dim/50 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Logo className="h-4 w-4 text-bone-dim/40" monochrome />
                <span className="font-mono uppercase tracking-wider">Vampchain · Base Sepolia</span>
              </div>
              <p>
                Unaudited, experimental, single-relayer bridge trust model. Read the{" "}
                <Link href="/terms" className="text-bone-dim/70 underline underline-offset-2 hover:text-bone">
                  terms
                </Link>{" "}
                before you send anything real value.
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
