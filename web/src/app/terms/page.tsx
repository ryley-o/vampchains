import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5 px-5 py-16 text-sm leading-6 text-bone-dim/80 sm:py-20">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">Read before you bite</p>
      <h1 className="text-display text-4xl text-bone">Terms &amp; disclaimers</h1>

      <p>
        Vampchain is early, unaudited, experimental software. Read this before you send anything
        of real value through it.
      </p>

      <h2 className="text-display pt-3 text-lg text-bone">What this actually is</h2>
      <p>
        Each vampchain is a single-node sidechain we operate. It is not decentralized, it has no
        real consensus, and the bridge between the home chain and a vampchain is secured by a
        single relayer key we control — not a light client, not a multisig, not a fraud-proof
        system. If our relayer key is compromised or we act maliciously, funds locked in the
        bridge are at risk. Treat anything you put into a vampchain the way you&apos;d treat play
        money, not the way you&apos;d treat a real bank balance.
      </p>

      <h2 className="text-display pt-3 text-lg text-bone">Funding &amp; chain lifecycle</h2>
      <p>
        A chain&apos;s funding balance is public and drawn down linearly over time to cover our
        real infrastructure cost. Anyone can top it up. If a chain&apos;s funding runs out, it
        doesn&apos;t shut down immediately — it stays fully open (deposits, minting, top-ups, all
        of it) for a one-week grace period, giving anyone a real window to fund it back up before
        anything actually comes down. If nobody does, we take a final snapshot of every real
        balance the chain had, publish it, and infrastructure is torn down for good — that
        specific chain does not come back, though a new chain for the same token (new address, new
        history) can always be created from scratch afterward.
      </p>
      <p>
        Once a chain is torn down, funds that were bridged in but never bridged back out don&apos;t
        just disappear: for 30 days after the snapshot, you can look up your wallet on the{" "}
        <Link href="/claim" className="underline underline-offset-2 hover:text-bone">
          claim page
        </Link>{" "}
        and withdraw whatever it shows, based on that final snapshot. After 30 days, whatever
        hasn&apos;t been claimed is swept to the protocol. This is best-effort infrastructure we
        run ourselves, not a guarantee — a bug in the snapshot process, a compromised relayer key,
        or us simply failing to run this correctly could still mean funds are lost. Don&apos;t
        leave meaningful value sitting on a chain that&apos;s close to running out of funding —
        top it up or bridge out while you still easily can.
      </p>

      <h2 className="text-display pt-3 text-lg text-bone">
        Vampchain (the business) can shut down, and your chain can be frozen
      </h2>
      <p>
        Vampchain is a memechain protocol run by a small team, not a foundation, not a DAO, and
        not a regulated custodian. At any point, and for any reason — running out of money,
        regulatory pressure, deciding to stop operating, or anything else — we may wind the
        business down entirely. If that happens:
      </p>
      <ul className="list-disc space-y-1.5 pl-5">
        <li>Any or all vampchains may have their state frozen, including chains that still have
          funding remaining.</li>
        <li>We will make a best effort to publish a window during which base-chain (L1) tokens
          locked in the bridge can be withdrawn, and to give advance notice before that window
          closes. This is a best effort, not a guarantee — it may be shorter than you&apos;d like,
          or in an extreme case (compromised relayer key, critical bug, legal order) it may not be
          possible to offer a withdrawal window at all.
        </li>
        <li>Funds that are sitting inside other protocols, contracts, or dApps deployed on a
          vampchain&apos;s sidechain — not simply held as a balance — are at additional risk on
          top of the above. If the sidechain is frozen or torn down, funds committed to a
          third-party contract on that chain may be lost even if the bridge itself offers a
          withdrawal window, because there&apos;s no guarantee that contract can still be exited
          in time or at all.
        </li>
      </ul>

      <h2 className="text-display pt-3 text-lg text-bone">This is experimental — funds can be lost forever</h2>
      <p>
        Beyond the business-continuity risk above, every vampchain is unaudited software running
        on a trust model with a single relayer key and a single-node sidechain — see
        &quot;What this actually is&quot; above. Smart contract bugs, relayer key compromise, node
        failure, or any other technical fault could result in permanent, total loss of funds
        bridged into a vampchain, independent of anything the business chooses to do. Treat every
        token you bridge into a vampchain — and every dollar of value you put at risk by doing so
        — as money you are fully prepared to lose forever, with no recovery path.
      </p>

      <h2 className="text-display pt-3 text-lg text-bone">Acceptable use</h2>
      <p>
        Don&apos;t use vampchains for anything illegal: money laundering, sanctions evasion, fraud,
        securities violations, or deploying tokens/contracts designed to defraud or deceive other
        people. We reserve the right to refuse or shut down a chain we believe is being used for
        this. Creating a chain does not make it &quot;official,&quot; registered, or endorsed by us
        in any way — it&apos;s infrastructure, not a listing or an investment product, and nothing
        here is investment advice.
      </p>

      <h2 className="text-display pt-3 text-lg text-bone">No warranty, no legal recourse</h2>
      <p>
        Provided as-is, with no warranty of any kind, express or implied. To the fullest extent
        the law allows, we are not liable for any loss of funds, data, or uptime arising from
        using vampchains — including loss caused by a chain freeze, a shutdown of the business, a
        bridge or relayer failure, a smart contract bug, or funds lost inside a third-party
        protocol deployed on a vampchain. By using vampchain you accept that bridged funds are
        experimental, that you may have no practical legal recourse to recover them if something
        goes wrong, and that this is a real, not theoretical, risk. This applies for as long as
        vampchain remains an early-stage, unaudited protocol — at least for now.
      </p>
    </div>
  );
}
