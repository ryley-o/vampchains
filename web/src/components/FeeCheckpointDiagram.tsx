"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// A small interactive illustration of the checkpoint model: total revenue
// only ever rises, a "paid out" line steps up to meet it each time you
// claim, and the gap between them is what one claim pays. Both are measured
// against the same vertical scale — the common datum that makes it
// impossible to ever pay the same revenue twice.
//
// Built with the same toolkit as the rest of the site (inline SVG + a
// little state, no chart library, no new dependency). Respects
// prefers-reduced-motion: when reduced, it holds a static, fully-labeled
// frame instead of auto-advancing, and the Claim button still works.

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 16, right: 16, bottom: 28, left: 16 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

const CAP = 56; // samples across a full cycle
const MAX_EARNED = 100; // top of the scale

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

// y grows upward on screen means larger amounts are higher → smaller SVG y.
function yFor(amount: number) {
  return PAD.top + PLOT_H * (1 - amount / MAX_EARNED);
}
function xFor(i: number) {
  return PAD.left + PLOT_W * (i / CAP);
}

// A representative static frame for reduced-motion: a half-filled cycle
// with one prior claim, so every labeled piece is visible at rest.
function staticSamples(): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 34; i++) out.push(Math.min(MAX_EARNED, i * 1.9));
  return out;
}

export function FeeCheckpointDiagram() {
  const reduced = usePrefersReducedMotion();
  const [samples, setSamples] = useState<number[]>([0]);
  const [paid, setPaid] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(true);
  const [flash, setFlash] = useState<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const earned = samples[samples.length - 1] ?? 0;
  const claimable = Math.max(0, earned - paid);

  // `reduced` is only known after mount (media query). When it resolves to
  // true, drop into a static, fully-labeled frame instead of animating —
  // done here rather than in the state initializer since that runs before
  // the media query is read. Only applies while still at the untouched
  // start state, so it never stomps a user who has interacted.
  useEffect(() => {
    if (reduced && samples.length === 1 && samples[0] === 0 && paid === 0) {
      setSamples(staticSamples());
      setPaid(26);
      setPlaying(false);
    }
  }, [reduced, samples, paid]);

  // Time advance: append a rising sample each tick; reset the cycle once
  // the timeline fills, so the illustration loops cleanly.
  useEffect(() => {
    if (!playing || reduced) return;
    const id = setInterval(() => {
      setSamples((prev) => {
        const last = prev[prev.length - 1] ?? 0;
        if (prev.length >= CAP || last >= MAX_EARNED) {
          setPaid(0);
          return [0];
        }
        const step = 1.4 + Math.random() * 2.6;
        return [...prev, Math.min(MAX_EARNED, last + step)];
      });
    }, 420);
    return () => clearInterval(id);
  }, [playing, reduced]);

  const claim = useCallback(() => {
    setPaid(earned);
    setFlash(claimable);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  }, [earned, claimable]);

  useEffect(() => () => void (flashTimer.current && clearTimeout(flashTimer.current)), []);

  // Area path under the earned curve.
  const areaPath = (() => {
    if (samples.length < 2) return "";
    const top = samples.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(" L ");
    const baseY = yFor(0);
    const lastX = xFor(samples.length - 1);
    return `M ${xFor(0).toFixed(1)},${baseY.toFixed(1)} L ${top} L ${lastX.toFixed(1)},${baseY.toFixed(1)} Z`;
  })();

  const paidY = yFor(paid);
  const curW = xFor(Math.max(1, samples.length - 1));
  const nowX = xFor(samples.length - 1);
  const nowY = yFor(earned);

  return (
    <div className="rounded-2xl border border-hairline bg-ink-raised p-5 sm:p-6">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Total revenue rises over time; a paid-out line steps up to meet it each time you claim; the gap between them is what one claim pays."
      >
        <defs>
          <linearGradient id="fee-earned" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-blood)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--color-blood)" stopOpacity="0.08" />
          </linearGradient>
        </defs>

        {/* baseline */}
        <line x1={PAD.left} y1={yFor(0)} x2={WIDTH - PAD.right} y2={yFor(0)} stroke="var(--color-hairline)" />

        {/* total-earned area */}
        {areaPath && <path d={areaPath} fill="url(#fee-earned)" stroke="var(--color-blood)" strokeWidth="1.5" />}

        {/* already-paid region: mask the area below the paid line with the
            page background, leaving the bright claimable band above it */}
        {paid > 0 && (
          <rect
            x={PAD.left}
            y={paidY}
            width={curW - PAD.left}
            height={yFor(0) - paidY}
            fill="var(--color-ink-raised)"
            opacity="0.72"
          />
        )}

        {/* paid-out line (the checkpoint) */}
        <line
          x1={PAD.left}
          y1={paidY}
          x2={curW}
          y2={paidY}
          stroke="var(--color-bone-dim)"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />

        {/* "now" marker on the earned curve */}
        <circle cx={nowX} cy={nowY} r="4" fill="var(--color-blood-bright)">
          {!reduced && <animate attributeName="r" values="4;6;4" dur="1.6s" repeatCount="indefinite" />}
        </circle>

        {/* labels */}
        <text x={curW + 2} y={nowY - 6} fontSize="11" fill="var(--color-bone-dim)" textAnchor="end">
          total earned
        </text>
        {paid > 0 && (
          <text x={PAD.left + 2} y={paidY - 5} fontSize="11" fill="var(--color-bone-dim)" opacity="0.7">
            paid out
          </text>
        )}
        {claimable > 0.5 && (
          <text
            x={nowX - 6}
            y={(paidY + nowY) / 2 + 4}
            fontSize="11"
            fill="var(--color-blood-bright)"
            textAnchor="end"
          >
            claimable now
          </text>
        )}

        <text x={PAD.left} y={HEIGHT - 8} fontSize="10" fill="var(--color-bone-dim)" opacity="0.45">
          time →
        </text>
      </svg>

      {/* readouts + controls */}
      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="font-mono text-lg text-bone">{earned.toFixed(0)}</p>
          <p className="text-xs text-bone-dim/50">total earned</p>
        </div>
        <div>
          <p className="font-mono text-lg text-bone-dim">{paid.toFixed(0)}</p>
          <p className="text-xs text-bone-dim/50">already paid</p>
        </div>
        <div>
          <p className="font-mono text-lg text-blood-bright">{claimable.toFixed(0)}</p>
          <p className="text-xs text-bone-dim/50">you&apos;d get now</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3">
        {!reduced && (
          <button
            onClick={() => setPlaying((p) => !p)}
            className="rounded-full border border-hairline-strong px-4 py-1.5 text-xs font-semibold text-bone-dim transition-colors hover:border-bone-dim hover:text-bone"
          >
            {playing ? "Pause time" : "Let time pass"}
          </button>
        )}
        <button
          onClick={claim}
          disabled={claimable < 0.5}
          className="rounded-full bg-blood px-5 py-1.5 text-xs font-semibold text-bone transition-colors hover:bg-blood-bright disabled:opacity-40"
        >
          {flash !== null ? `Claimed ${flash.toFixed(0)} ✓` : "Claim"}
        </button>
      </div>

      <p className="mt-4 text-center text-xs text-bone-dim/50">
        The contract remembers only the dashed line — how much it has already paid. Your claim shows
        the current top. You get the gap. Same scale on both, so it can never pay past the top.
      </p>
    </div>
  );
}
