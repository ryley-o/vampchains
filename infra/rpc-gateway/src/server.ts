import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { prisma } from "@vampchains/db";
import { isAllowedMethod } from "./allowlist.js";
import { RateLimiter } from "./rateLimiter.js";
import type { GatewayConfig } from "./config.js";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

const METHOD_NOT_ALLOWED_CODE = -32601;
const INVALID_REQUEST_CODE = -32600;
const INTERNAL_ERROR_CODE = -32603;

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

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

function checkMethods(body: JsonRpcRequest | JsonRpcRequest[]): { ok: true } | { ok: false; response: unknown } {
  const items = Array.isArray(body) ? body : [body];
  const rejected = items.filter((item) => !isAllowedMethod(item?.method));
  if (rejected.length === 0) return { ok: true };

  const errors = rejected.map((item) =>
    rpcError(item?.id ?? null, METHOD_NOT_ALLOWED_CODE, `method "${String(item?.method)}" is not allowed on this gateway`)
  );
  return { ok: false, response: Array.isArray(body) ? errors : errors[0] };
}

export function createGatewayServer(config: GatewayConfig) {
  const limiter = new RateLimiter(config.rateLimitCapacity, config.rateLimitRefillPerSec);

  return createServer(async (req, res) => {
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

    const claimMatch = req.url?.match(/^\/claims\/(0x[0-9a-fA-F]{64})\/?$/);
    if (req.method === "GET" && claimMatch) {
      if (!limiter.tryConsume(clientIp(req))) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "rate limit exceeded" }));
        return;
      }

      const sidechainTxHash = claimMatch[1]!;
      const withdrawal = await prisma.withdrawalEvent.findUnique({ where: { sidechainTxHash } });

      if (!withdrawal || !withdrawal.signature) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "pending" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ready",
          chainId: withdrawal.chainId.toString(),
          // Null for the chain's own base token (native-currency claim);
          // set to the L1 token address for a general-bridged wrapped
          // token — see docs/ARCHITECTURE.md "General ERC20 bridging".
          // The frontend uses this to decide whether to call
          // VampBridge.claim() or .claimToken().
          token: withdrawal.token,
          // USER (the common case) means submit `to`/`amount`/`signature`
          // to claim()/claimToken() as normal. FEE_SWEEP means this is
          // protocol-swept fee revenue: submit the same fields to
          // claimSwept() instead (no `token` path exists for this kind),
          // which ignores `to` and splits 50/50 between the protocol
          // treasury and the chain's creator on-chain — see
          // docs/ARCHITECTURE.md "Protocol fee revenue".
          kind: withdrawal.kind,
          to: withdrawal.to,
          amount: withdrawal.amount,
          sidechainTxHash: withdrawal.sidechainTxHash,
          signature: withdrawal.signature,
        })
      );
      return;
    }

    const feesMatch = req.url?.match(/^\/fees\/(\d+)\/?$/);
    if (req.method === "GET" && feesMatch) {
      if (!limiter.tryConsume(clientIp(req))) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "rate limit exceeded" }));
        return;
      }

      // Routing key is evmChainId, not the registry-native chainId — the
      // latter is only unique within a home chain, see Chain model docstring.
      const evmChainId = BigInt(feesMatch[1]!);
      const chain = await prisma.chain.findUnique({ where: { evmChainId } });

      if (!chain || !chain.baseFeeAttestationSignature || !chain.baseFeeAttestedAt) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "pending" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ready",
          evmChainId: chain.evmChainId.toString(),
          // The cumulative EIP-1559 base-fee burn attested as of
          // `asOfBlock`, in the base token's own raw decimal units — submit
          // together with `signature` to VampBridge.claimBurnedFees(), which
          // only ever pays out the increment over what's already been
          // claimed and splits it 50/50 with the chain's creator. See
          // docs/ARCHITECTURE.md "Protocol fee revenue".
          cumulativeBurned: chain.cumulativeBaseFeeBurned,
          asOfBlock: chain.baseFeeScanBlock.toString(),
          signature: chain.baseFeeAttestationSignature,
        })
      );
      return;
    }

    const match = req.url?.match(/^\/rpc\/(\d+)\/?$/);
    if (req.method !== "POST" || !match) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    // Routing key is evmChainId, not the registry-native chainId — see the
    // /fees route above and the Chain model's docstring for why.
    const evmChainId = BigInt(match[1]!);

    if (!limiter.tryConsume(clientIp(req))) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify(rpcError(null, -32005, "rate limit exceeded")));
      return;
    }

    let body: JsonRpcRequest | JsonRpcRequest[];
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(rpcError(null, INVALID_REQUEST_CODE, "invalid JSON")));
      return;
    }

    const methodCheck = checkMethods(body);
    if (!methodCheck.ok) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify(methodCheck.response));
      return;
    }

    const chain = await prisma.chain.findUnique({ where: { evmChainId } });
    if (!chain || chain.status !== "ACTIVE" || !chain.rpcUrl) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(rpcError(null, INVALID_REQUEST_CODE, `chain ${evmChainId} is not active`)));
      return;
    }

    try {
      const upstream = await fetch(chain.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { "Content-Type": "application/json" });
      res.end(text);
    } catch (err) {
      console.error(`[gateway] upstream request to chain ${evmChainId} failed:`, err);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify(rpcError(null, INTERNAL_ERROR_CODE, "upstream node unreachable")));
    }
  });
}
