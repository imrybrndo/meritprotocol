import type { Metadata } from "next";
import { Eyebrow, Panel, PanelHeader } from "@/components/ui/primitives";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = {
  title: "Verify",
  description:
    "Independently verify any decision recorded with MERIT — commitment, Merkle proof, root and on-chain anchor.",
};

export default async function VerifyPage({
  searchParams,
}: PageProps<"/verify">) {
  const params = await searchParams;
  const query = typeof params.query === "string" ? params.query : undefined;

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-12 sm:px-6">
      <Eyebrow>Independent verification</Eyebrow>
      <h1 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-ink">
        Verify a trade.
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Paste any decision ID, commitment hash, or anchor transaction hash. MERIT
        recomputes the commitment from the stored fields, walks the Merkle path
        to the batch root, and re-reads the anchor from the chain. Nothing is
        taken from the database on trust.
      </p>

      <div className="mt-8">
        <VerifyForm initialQuery={query} />
      </div>

      <Panel className="mt-10">
        <PanelHeader title="Verifying without us" />
        <div className="space-y-3 px-4 py-4 text-xs leading-relaxed text-ink-dim">
          <p>
            The endpoint behind this page is public and unauthenticated:{" "}
            <code className="font-mono text-ink-muted">POST /api/v1/verify</code>.
            So is <code className="font-mono text-ink-muted">GET /api/v1/proofs/:id</code>,
            which returns the leaf, the sibling path and the root as a
            self-contained object.
          </p>
          <p>
            With that object you can recompute the root yourself: hash the
            commitment under the leaf domain tag, fold each sibling in the given
            order, and compare against the anchored root. The algorithm is
            SHA-256 with domain-separated leaf and node tags, and unpaired nodes
            are promoted rather than duplicated. No MERIT code is required — and
            the on-chain payload can be read straight from any RPC endpoint.
          </p>
        </div>
      </Panel>
    </div>
  );
}
