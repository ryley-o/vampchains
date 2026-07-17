import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @vampchains/db is a workspace package whose "main" points at raw TS
  // source, not prebuilt JS — this tells Next to compile it like local code.
  transpilePackages: ["@vampchains/db"],
};

export default nextConfig;
