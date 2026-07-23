export interface VerifierConfig {
  port: number;
  rateLimitCapacity: number;
  rateLimitRefillPerSec: number;
  /// Always reached through the public rpc-gateway, never a raw internal
  /// rpcUrl — this service verifies a submitter's claim about what's
  /// deployed, so it should see exactly what any outside caller would see
  /// through the same public path everything else uses.
  gatewayUrl: string;
  /// Hard wall-clock cap per compile — `via_ir` compiles are a known
  /// slow/DoS-shaped surface, so a compile that runs long gets killed
  /// rather than tying up a Fly instance indefinitely.
  compileTimeoutMs: number;
  /// Total submitted source size across every file in standardJsonInput,
  /// in bytes — a cheap early reject before any compile is attempted.
  maxSourceBytes: number;
}

export function loadConfig(): VerifierConfig {
  return {
    port: Number(process.env.PORT ?? 8080),
    rateLimitCapacity: Number(process.env.RATE_LIMIT_CAPACITY ?? 5),
    rateLimitRefillPerSec: Number(process.env.RATE_LIMIT_REFILL_PER_SEC ?? 0.2),
    gatewayUrl: process.env.GATEWAY_URL ?? "http://localhost:18080",
    compileTimeoutMs: Number(process.env.COMPILE_TIMEOUT_MS ?? 90_000),
    maxSourceBytes: Number(process.env.MAX_SOURCE_BYTES ?? 2_000_000),
  };
}
