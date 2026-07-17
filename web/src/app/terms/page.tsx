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
        real infrastructure cost. Anyone can top it up. If a chain&apos;s funding runs out
        completely, its infrastructure is torn down and it does not come back — a new chain (new
        token, new address, new history) would have to be created from scratch. Tokens you&apos;ve
        bridged in but never bridged back out before a teardown may become unrecoverable through
        the normal withdrawal flow. Don&apos;t leave meaningful value sitting on a chain that&apos;s
        close to running out of funding — top it up or bridge out.
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

      <h2 className="text-display pt-3 text-lg text-bone">No warranty</h2>
      <p>
        Provided as-is, with no warranty of any kind, express or implied. We are not liable for
        any loss of funds, data, or uptime arising from using vampchains.
      </p>
    </div>
  );
}
