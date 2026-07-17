import { createConfig, http, injected } from "wagmi";
import { l1Chain } from "./viemClients";

// Injected-only (MetaMask/Rabby/etc) for MVP — no WalletConnect project ID
// required, so local dev works with zero external accounts. Swapping in
// RainbowKit/ConnectKit later for broader wallet support + a nicer connect
// UI is a drop-in upgrade, not a rearchitecture.
export const wagmiConfig = createConfig({
  chains: [l1Chain],
  connectors: [injected()],
  transports: {
    [l1Chain.id]: http(),
  },
});
