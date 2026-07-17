import { loadConfig } from "./config.js";
import { createGatewayServer } from "./server.js";

const config = loadConfig();
const server = createGatewayServer(config);

server.listen(config.port, () => {
  console.log(`vampchains rpc-gateway listening on :${config.port}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
