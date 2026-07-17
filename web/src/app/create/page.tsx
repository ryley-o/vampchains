import { CreateChainForm } from "@/components/CreateChainForm";

export default function CreatePage() {
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-bold">Create a vampchain</h1>
      <p className="text-sm text-neutral-400">
        Pick any existing ERC20 token. Pay the annual USDC fee. We spin up a single-node sidechain
        that uses your token as gas.
      </p>
      <CreateChainForm />
    </div>
  );
}
