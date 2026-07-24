import { AddressChip } from "@/components/AddressChip";

export function AddressLink({ evmChainId, address }: { evmChainId: string; address: string }) {
  return (
    <AddressChip
      address={address}
      href={`/${evmChainId}/address/${address}`}
      linkClassName="text-bone-dim hover:text-blood-bright"
    />
  );
}
