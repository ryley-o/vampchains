import { loadConfig } from "./config.js";
import { createVerifierServer } from "./server.js";

const config = loadConfig();
const server = createVerifierServer(config);

server.listen(config.port, () => {
  console.log(`vampchains verifier listening on :${config.port} (gateway=${config.gatewayUrl})`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
