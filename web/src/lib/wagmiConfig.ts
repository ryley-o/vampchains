import { type CreateConnectorFn, createConfig, http, injected } from "wagmi";
import { walletConnect } from "wagmi/connectors";
import { HOME_VIEM_CHAINS } from "./viemClients";
import { WALLETCONNECT_PROJECT_ID } from "./contracts";

// Injected (MetaMask/Rabby/etc, desktop extensions and wallets' in-app
// browsers) plus WalletConnect (QR-code pairing — the only realistic way for
// a plain mobile browser tab to reach a wallet app). WalletConnect only gets
// added when a project id is actually configured, so local dev without one
// still works, just injected-only. Also gated on `window` existing: this
// module is imported by a "use client" component that Next.js still
// executes during server-side prerendering, and @walletconnect/ethereum-provider
// touches indexedDB in its constructor — unguarded, that crashes the build.
const connectors: CreateConnectorFn[] = [injected()];
if (typeof window !== "undefined" && WALLETCONNECT_PROJECT_ID) {
  connectors.push(
    walletConnect({
      projectId: WALLETCONNECT_PROJECT_ID,
      showQrModal: true,
      metadata: {
        name: "Vampchain",
        description: "Pick any ERC20. We turn it into the native gas of its very own blockchain.",
        // Must match the origin the page actually serves from — vampchain.com
        // 308-redirects to www, and WalletConnect checks this against
        // window.location for its wallet-side domain verification.
        url: "https://www.vampchain.com",
        icons: ["https://www.vampchain.com/brand/social-avatar.svg"],
      },
    })
  );
}

export const wagmiConfig = createConfig({
  chains: HOME_VIEM_CHAINS,
  connectors,
  transports: Object.fromEntries(HOME_VIEM_CHAINS.map((chain) => [chain.id, http()])),
});
