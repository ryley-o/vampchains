"use client";

import { useEffect, useState } from "react";
import { Logo } from "./Logo";

const SESSION_KEY = "vampchain-intro-seen";

/// The full-page "what is this?" threshold new visitors cross before
/// landing on the real site. Gated to once per browser session (not every
/// visit to `/`) and skippable at every step — a locked door is bad UX no
/// matter how good the door looks. Skips entirely under
/// prefers-reduced-motion.
export function CinematicIntro() {
  const [phase, setPhase] = useState<"hidden" | "intro" | "exiting" | "gone">("hidden");

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seen = sessionStorage.getItem(SESSION_KEY);
    if (seen || reduced) {
      setPhase("gone");
      return;
    }
    sessionStorage.setItem(SESSION_KEY, "1");
    setPhase("intro");
  }, []);

  function enter() {
    setPhase("exiting");
    window.setTimeout(() => setPhase("gone"), 750);
  }

  useEffect(() => {
    if (phase !== "intro" && phase !== "exiting") return;
    const { style: htmlStyle } = document.documentElement;
    const { style: bodyStyle } = document.body;
    const prevHtmlOverflow = htmlStyle.overflow;
    const prevBodyOverflow = bodyStyle.overflow;
    htmlStyle.overflow = "hidden";
    bodyStyle.overflow = "hidden";
    return () => {
      htmlStyle.overflow = prevHtmlOverflow;
      bodyStyle.overflow = prevBodyOverflow;
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "intro") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") enter();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  if (phase === "hidden" || phase === "gone") return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink px-6 text-center transition-[clip-path] duration-700 ease-[var(--ease-fang)] ${
        phase === "exiting" ? "[clip-path:circle(0%_at_50%_50%)]" : "[clip-path:circle(150%_at_50%_50%)]"
      }`}
      role="dialog"
      aria-label="Welcome to Vampchain"
    >
      <div className="pattern-drift pointer-events-none absolute inset-0 opacity-40" />

      {phase === "exiting" && (
        <>
          <span className="absolute left-1/2 top-1/2 h-3 w-1 -translate-x-3 -translate-y-1/2 rounded-full bg-blood-bright" />
          <span className="absolute left-1/2 top-1/2 h-3 w-1 translate-x-2 -translate-y-1/2 rounded-full bg-blood-bright" />
        </>
      )}

      <button
        onClick={enter}
        className="absolute right-5 top-5 font-mono text-xs uppercase tracking-widest text-bone-dim/50 transition-colors hover:text-bone-dim"
      >
        Skip →
      </button>

      <div
        className={`relative flex flex-col items-center transition-all duration-700 ${
          phase === "exiting" ? "scale-95 opacity-0" : "animate-[intro-rise_0.9s_ease-out_both]"
        }`}
      >
        <Logo className="text-glow h-16 w-16 text-bone sm:h-20 sm:w-20" />

        <h1 className="text-display mt-6 text-4xl text-bone sm:text-6xl">
          What is this?
        </h1>

        <p className="mt-5 max-w-md text-balance text-base text-bone-dim/80 sm:text-lg">
          Pick any ERC20. We turn it into the native gas of its very own blockchain. One token,
          one chain, one whole little universe.
        </p>

        <button
          onClick={enter}
          className="mt-9 rounded-full bg-blood px-8 py-3.5 text-sm font-semibold uppercase tracking-wider text-bone shadow-[0_0_40px_rgba(226,45,58,0.4)] transition-all hover:scale-105 hover:bg-blood-bright hover:shadow-[0_0_60px_rgba(226,45,58,0.6)] active:scale-95"
        >
          Enter Vampchain
        </button>

        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-bone-dim/40">
          It vampires tokens.
        </p>
      </div>
    </div>
  );
}
