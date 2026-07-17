export interface GatewayConfig {
  port: number;
  rateLimitCapacity: number;
  rateLimitRefillPerSec: number;
}

export function loadConfig(): GatewayConfig {
  return {
    port: Number(process.env.PORT ?? 8080),
    rateLimitCapacity: Number(process.env.RATE_LIMIT_CAPACITY ?? 30),
    rateLimitRefillPerSec: Number(process.env.RATE_LIMIT_REFILL_PER_SEC ?? 10),
  };
}
