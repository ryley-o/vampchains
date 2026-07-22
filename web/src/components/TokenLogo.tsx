"use client";

import { useState } from "react";
import { identiconUrl, trustWalletLogoUrl } from "@/lib/tokenLogo";

export function TokenLogo({
  address,
  chainId,
  size = 32,
  className,
}: {
  address: string;
  chainId: number;
  size?: number;
  className?: string;
}) {
  const [primaryFailed, setPrimaryFailed] = useState(false);
  const primary = trustWalletLogoUrl(chainId, address);
  const src = !primaryFailed && primary ? primary : identiconUrl(address);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- external, per-token image; no build-time optimization possible
    <img
      src={src}
      onError={() => setPrimaryFailed(true)}
      width={size}
      height={size}
      alt=""
      className={`shrink-0 rounded-full border border-hairline bg-charcoal-soft object-cover ${className ?? ""}`}
    />
  );
}
