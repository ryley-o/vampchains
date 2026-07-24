import Link from "next/link";
import { shortAddress } from "@/lib/format";
import { CopyButton } from "@/components/CopyButton";

/// Renders an address (shortened by default) with a copy button glued to
/// its right side — the one place this formatting decision lives, so every
/// address on the site gets the same copy affordance for free.
export function AddressChip({
  address,
  href,
  short = true,
  className = "",
  linkClassName = "",
}: {
  address: string;
  href?: string;
  short?: boolean;
  className?: string;
  linkClassName?: string;
}) {
  const label = short ? shortAddress(address) : address;

  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {href ? (
        <Link href={href} className={`font-mono ${linkClassName || className}`}>
          {label}
        </Link>
      ) : (
        <span className={`font-mono ${className}`}>{label}</span>
      )}
      <CopyButton value={address} />
    </span>
  );
}
