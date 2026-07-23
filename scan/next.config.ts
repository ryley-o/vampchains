import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @vampchains/db and @vampchains/contract-abis are workspace packages
  // whose "main" points at raw TS source, not prebuilt JS — this tells
  // Next to compile them like local code.
  transpilePackages: ["@vampchains/db", "@vampchains/contract-abis"],
};

export default nextConfig;
