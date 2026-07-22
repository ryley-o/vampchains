"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { useState } from "react";
import { wagmiConfig } from "@/lib/wagmiConfig";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    // reconnectOnMount (default true) only restores a session for a wallet
    // that already authorized this site on a previous visit — it calls
    // connector.isAuthorized() first, so a first-time visitor never gets a
    // silent/automatic connection. Leave it on so returning users stay
    // connected across refreshes.
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
