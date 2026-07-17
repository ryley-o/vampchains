import { CreateChainForm } from "@/components/CreateChainForm";
import { FangDivider } from "@/components/brand/FangDivider";

export default function CreatePage() {
  return (
    <div className="mx-auto max-w-xl px-5 py-16 sm:py-20">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">New chain</p>
      <h1 className="text-display mt-2 text-4xl text-bone sm:text-5xl">Give it a universe.</h1>
      <p className="mt-4 text-base text-bone-dim/70">
        Any existing ERC20 qualifies. Pay the annual fee, and we spin up a single-node sidechain
        that runs on your token as gas.
      </p>
      <FangDivider className="my-10" />
      <CreateChainForm />
    </div>
  );
}
