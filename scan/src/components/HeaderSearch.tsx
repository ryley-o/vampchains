"use client";

import { useParams } from "next/navigation";
import { ChainSearchBar } from "@/components/ChainSearchBar";
import { ChainScopedSearchBar } from "@/components/ChainScopedSearchBar";

/// Lives in the root layout, so it renders on every page — but what it
/// searches has to change depending on whether a chain is already picked.
/// `useParams()` reflects the whole matched route regardless of which
/// layout level calls it, so this alone is enough to tell landing-page
/// (no evmChainId) apart from any /[evmChainId]/... page.
export function HeaderSearch() {
  const params = useParams<{ evmChainId?: string }>();
  if (params?.evmChainId) return <ChainScopedSearchBar evmChainId={params.evmChainId} />;
  return <ChainSearchBar />;
}
