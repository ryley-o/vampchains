import Link from "next/link";
import { shortAddress } from "@/lib/format";

export function AddressLink({ evmChainId, address }: { evmChainId: string; address: string }) {
  return (
    <Link href={`/${evmChainId}/address/${address}`} className="font-mono text-bone-dim hover:text-blood-bright">
      {shortAddress(address)}
    </Link>
  );
}
