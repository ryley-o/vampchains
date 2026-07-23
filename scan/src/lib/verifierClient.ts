// Must be a literal `process.env.NEXT_PUBLIC_X` property access, not a
// computed one — Next.js inlines NEXT_PUBLIC_ vars into the client bundle
// via static text replacement at build time, not a real env object shipped
// to the browser. A dynamic lookup silently resolves to undefined forever
// regardless of what's configured in Vercel (this exact bug shipped a
// broken client-side address to production once already — see web/'s
// contracts.ts and its fix commit).
export const VERIFIER_URL = process.env.NEXT_PUBLIC_VERIFIER_URL ?? "http://localhost:8091";
