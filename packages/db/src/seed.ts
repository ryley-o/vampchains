import { prisma } from "./index.js";

async function main() {
  const chain = await prisma.chain.upsert({
    where: { chainId: 1n },
    update: {},
    create: {
      chainId: 1n,
      evmChainId: 900001n,
      baseToken: "0x0000000000000000000000000000000000dEaD",
      baseTokenName: "Doge Base",
      baseTokenSymbol: "DOGB",
      baseTokenDecimals: 18,
      name: "Dogeblock",
      symbol: "DOGB",
      creator: "0x000000000000000000000000000000000000f0",
      status: "ACTIVE",
      flyAppName: "vampchain-1-local",
      rpcUrl: "http://localhost:8546",
    },
  });

  console.log("seeded chain:", chain);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
