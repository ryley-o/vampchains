import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { RateLimiter } from "@vampchains/rate-limiter";
import type { VerifierConfig } from "./config.js";
import { verifyContract } from "./verify.js";
import { handleCheckVerifyStatus, handleGetAbi, handleVerifySourceCode } from "./etherscanCompat.js";

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["fly-client-ip"] ?? req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) return forwarded.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Live-testing against a real `forge verify-contract --verifier custom` run
// showed its request body carries no chain identifier at all (no `chainid`,
// no `module`/`apikey` even) — so, per this project's own rule that
// anything chain-scoped belongs in the route, evmChainId is a path segment:
// /etherscan-compat/api/<evmChainId>. The bare /etherscan-compat/api form
// still works for GET actions that don't need a chain (checkverifystatus).
const ETHERSCAN_COMPAT_RE = /^\/etherscan-compat\/api(?:\/(\d+))?$/;

/// Public HTTP surface for contract verification. Two POST routes doing
/// the exact same underlying compile-and-match work (verify.ts), just two
/// different wire shapes: /api/verify is a plain JSON endpoint for scan/'s
/// own web form, /etherscan-compat/api speaks just enough of Etherscan's
/// legacy verification API for `forge verify-contract --verifier custom`
/// to work against it unmodified. Rate-limited by visitor IP — the same
/// RateLimiter class rpc-gateway uses, valid here for the same reason
/// (persistent Fly instances, not serverless), gating only these
/// compile-triggering routes rather than every request.
export function createVerifierServer(config: VerifierConfig) {
  const limiter = new RateLimiter(config.rateLimitCapacity, config.rateLimitRefillPerSec);

  return createServer(async (req, res) => {
    try {
      await handleRequest(req, res, config, limiter);
    } catch (err) {
      // A single bad/unexpected request must never take down the whole
      // process — every route below already has its own try/catch for
      // expected failure modes, but this is the backstop for anything
      // that isn't (e.g. a genuinely unexpected exception mid-request).
      console.error("[verifier] unhandled error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal error" }));
      }
    }
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, config: VerifierConfig, limiter: RateLimiter) {
    console.log(`[verifier] ${req.method} ${req.url}`);
    setCors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (req.method === "POST" && req.url === "/api/verify") {
      if (!limiter.tryConsume(clientIp(req))) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "rate limit exceeded — try again shortly" }));
        return;
      }
      try {
        const body = JSON.parse(await readBody(req));
        const outcome = await verifyContract(body, config);
        res.writeHead(outcome.success ? 200 : 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(outcome));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : "invalid request" }));
      }
      return;
    }

    // Etherscan's real API serves checkverifystatus as a GET (it's just a
    // status lookup) — support that shape too, since forge's client may
    // use either depending on version.
    if (req.method === "GET" && req.url) {
      const url = new URL(req.url, "http://localhost");
      const pathMatch = ETHERSCAN_COMPAT_RE.exec(url.pathname);
      if (pathMatch) {
        const evmChainId = pathMatch[1];
        const action = url.searchParams.get("action");
        if (action === "checkverifystatus") {
          const result = handleCheckVerifyStatus(url.searchParams);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
          return;
        }
        if (action === "getabi") {
          const address = url.searchParams.get("address") ?? "";
          const result = await handleGetAbi(evmChainId ?? "", address);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
          return;
        }
      }
    }

    if (req.method === "POST" && req.url) {
      const url = new URL(req.url, "http://localhost");
      const pathMatch = ETHERSCAN_COMPAT_RE.exec(url.pathname);
      if (pathMatch) {
        const evmChainId = pathMatch[1];
        const raw = await readBody(req);
        const contentType = req.headers["content-type"] ?? "";
        const params = contentType.includes("application/json") ? new URLSearchParams(Object.entries(JSON.parse(raw))) : new URLSearchParams(raw);
        const action = params.get("action");

        if (action === "verifysourcecode") {
          if (!evmChainId) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "0", message: "NOTOK", result: "verifier URL must include the vampchain's evmChainId, e.g. /etherscan-compat/api/<evmChainId>" }));
            return;
          }
          if (!limiter.tryConsume(clientIp(req))) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "0", message: "NOTOK", result: "rate limit exceeded — try again shortly" }));
            return;
          }
          const result = await handleVerifySourceCode(params, config, evmChainId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
          return;
        }

        if (action === "checkverifystatus") {
          const result = handleCheckVerifyStatus(params);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "0", message: "NOTOK", result: `unsupported action "${action}"` }));
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
}
