export interface StandardJsonSources {
  path: string;
  content: string;
}

/// `VerifiedContract.standardJsonInput` is stored as opaque Prisma `Json`
/// (whatever infra/verifier's compile step was actually given) — this pulls
/// out just the `{path: {content}}` map into a flat list for display,
/// tolerating anything unexpected rather than throwing on a shape mismatch.
export function extractSources(standardJsonInput: unknown): StandardJsonSources[] {
  if (typeof standardJsonInput !== "object" || standardJsonInput === null) return [];
  const sources = (standardJsonInput as { sources?: unknown }).sources;
  if (typeof sources !== "object" || sources === null) return [];

  return Object.entries(sources as Record<string, unknown>)
    .map(([path, value]) => {
      const content = (value as { content?: unknown } | null)?.content;
      return typeof content === "string" ? { path, content } : null;
    })
    .filter((s): s is StandardJsonSources => s !== null);
}
