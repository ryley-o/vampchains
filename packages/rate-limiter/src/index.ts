interface Bucket {
  tokens: number;
  lastRefill: number;
}

/// Simple per-key token bucket, in-process memory. Valid specifically for a
/// small number of persistent process instances (Fly apps, not serverless
/// functions) — see docs/ARCHITECTURE.md known limitations for the caveat.
/// Originally infra/rpc-gateway's own class; extracted here once
/// infra/verifier needed the identical thing, so the two services can't
/// drift from each other.
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private capacity: number,
    private refillPerSec: number
  ) {
    // Prevent unbounded growth from one-off/spoofed IPs.
    setInterval(() => this.sweep(), 5 * 60_000).unref();
  }

  tryConsume(key: string, cost = 1): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSec);
    bucket.lastRefill = now;

    if (bucket.tokens < cost) return false;
    bucket.tokens -= cost;
    return true;
  }

  private sweep() {
    const staleBefore = Date.now() - 30 * 60_000;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefill < staleBefore) this.buckets.delete(key);
    }
  }
}
