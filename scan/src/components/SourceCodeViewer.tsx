"use client";

import { useState } from "react";
import type { StandardJsonSources } from "@/lib/standardJsonInput";

export function SourceCodeViewer({ sources }: { sources: StandardJsonSources[] }) {
  const [active, setActive] = useState(0);

  if (sources.length === 0) {
    return <p className="text-xs text-bone-dim/40">No source recorded for this verification.</p>;
  }

  return (
    <div>
      {sources.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2 border-b border-hairline pb-3">
          {sources.map((s, i) => (
            <button
              key={s.path}
              onClick={() => setActive(i)}
              className={`rounded-full px-3 py-1 font-mono text-xs ${
                i === active ? "bg-blood/20 text-blood-bright" : "text-bone-dim/50 hover:text-bone-dim"
              }`}
            >
              {s.path}
            </button>
          ))}
        </div>
      )}
      <pre className="max-h-[32rem] overflow-auto rounded-lg bg-ink p-4 text-xs leading-relaxed text-bone-dim">
        <code>{sources[active].content}</code>
      </pre>
    </div>
  );
}
