/// A section divider built from the brand mark's fang accents — the one
/// recurring signature shape, reused sparingly as punctuation between
/// sections instead of a generic <hr>.
export function FangDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`} aria-hidden="true">
      <span className="h-px w-16 bg-(--color-hairline-strong)" />
      <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
        <path d="M2 0 L6 4 L4 14 Z" fill="#E22D3A" />
        <path d="M14 0 L10 4 L12 14 Z" fill="#E22D3A" />
      </svg>
      <span className="h-px w-16 bg-(--color-hairline-strong)" />
    </div>
  );
}
