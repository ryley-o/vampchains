"use client";

import { useParams } from "next/navigation";
import { ChainScopedSearchBar } from "@/components/ChainScopedSearchBar";

/// Lives in the root layout, so it renders on every page — but a global
/// search box here reads as "search anything across every chain," which
/// isn't what this app does or should imply. Once a chain's picked, an
/// address/tx/block search scoped to it belongs in the header (you're
/// clearly "inside" that chain everywhere you go from here); the landing
/// page's chain search deliberately does NOT live here — it's inline in
/// the page content instead (ChainSearchBar in app/page.tsx), framed as
/// "search a chain, or pick one below" rather than floating in a navbar
/// that's present on every page regardless of context.
export function HeaderSearch() {
  const params = useParams<{ evmChainId?: string }>();
  if (params?.evmChainId) return <ChainScopedSearchBar evmChainId={params.evmChainId} />;
  return null;
}
