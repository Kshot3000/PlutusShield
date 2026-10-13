import type { Metadata } from "next";
import type { CoverWording, EnforcedBy } from "@plutusshield/sdk/wording";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { C, Callout, DocLink, H3, List, P, Section, Table } from "@/components/docs/Prose";
import { src } from "@/components/docs/nav";
import { WordingDownload } from "@/components/terms/WordingDownload";
import { Badge } from "@/components/ui/Badge";
import { DEPEG_WORDING, EXPLOIT_WORDING } from "@/lib/wording";

export const metadata: Metadata = {
  title: "Cover wording",
  description:
    "The plain-language terms of PlutusShield depeg and exploit cover: trigger, waiting period, term, premium, caps, payout and claim deadline, every number read from the Cardano Preview deployment and every clause tied to the check that enforces it.",
};

const TONE: Record<EnforcedBy, "accent" | "cardano" | "midnight" | "gold"> = {
  validator: "cardano",
  "oracle quorum": "accent",
  "assessor committee": "midnight",
  disclosure: "gold",
};

const LABEL: Record<EnforcedBy, string> = {
  validator: "Validator",
  "oracle quorum": "Oracle quorum",
  "assessor committee": "Committee",
  disclosure: "Disclosure",
};

function Wording({ w, id }: { w: CoverWording; id: string }) {
  return (
    <Section id={id} title={w.title}>
      <P>
        {w.network}. Every value below is read from <DocLink href={src(w.source)}>{w.source.split("/").pop()}</DocLink>, the
        parameters the validator was deployed with.
      </P>
      <WordingDownload wording={w} />
      <Table
        caption={`${w.title} schedule`}
        head={["Term", "Value", "Enforced by", "Check"]}
        rows={w.schedule.map((r) => [
          r.term,
          r.value,
          <Badge key="b" variant={TONE[r.enforcedBy]}>
            {LABEL[r.enforcedBy]}
          </Badge>,
          <C key="c">{r.check}</C>,
        ])}
      />
      {w.clauses.map((c, i) => (
        <div key={c.id} id={`${id}-${c.id}`} className="scroll-mt-28">
          <H3>
            {i + 1}. {c.heading}
          </H3>
          <P>{c.body}</P>
          <p className="flex flex-wrap items-center gap-2 text-[11px] text-text-dim">
            <Badge variant={TONE[c.enforcedBy]}>{LABEL[c.enforcedBy]}</Badge>
            <C>{c.check}</C>
          </p>
        </div>
      ))}
      <H3 id={`${id}-not-covered`}>Not covered</H3>
      <List>
        {w.notCovered.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </List>
    </Section>
  );
}

export default function TermsPage() {
  return (
    <DocsLayout
      slug="terms"
      title="Cover wording"
      description="What a PlutusShield policy promises, in plain words. Insurance wording usually asks you to trust the issuer; here each clause names who enforces it and the exact check in the source, so you can verify it instead."
      toc={[
        { id: "read-this", label: "How to read it" },
        { id: "depeg", label: DEPEG_WORDING.title },
        { id: "exploit", label: EXPLOIT_WORDING.title },
      ]}
      sourcePaths={[
        "packages/sdk/src/wording.ts",
        "packages/sdk/test/wording.test.ts",
        "contracts/cardano/validators/cover.ak",
        "contracts/cardano/validators/exploit_cover.ak",
      ]}
    >
      <Section id="read-this" title="How to read it">
        <P>
          The wording is generated from the deployment records, not typed by hand: change a parameter and the wording
          changes with it, and the SDK tests pin the numbers to the live Preview pools.
        </P>
        <List>
          <li>
            <Badge variant="cardano">Validator</Badge> means a transaction that breaks the clause cannot land on Cardano.
          </li>
          <li>
            <Badge variant="accent">Oracle quorum</Badge> means the clause is decided by signed oracle feed readings the
            validator checks.
          </li>
          <li>
            <Badge variant="midnight">Committee</Badge> means people decide it: the assessor committee, whose signatures the
            validator counts.
          </li>
          <li>
            <Badge variant="gold">Disclosure</Badge> is something you should know that no code enforces.
          </li>
        </List>
        <Callout tone="warn" title="Testnet only">
          These are the terms of the Preview testnet pools, with test value only. The contracts are not audited and this is
          not a regulated insurance contract. See <DocLink href="/docs/risks">Risks &amp; disclosures</DocLink>.
        </Callout>
      </Section>
      <Wording w={DEPEG_WORDING} id="depeg" />
      <Wording w={EXPLOIT_WORDING} id="exploit" />
    </DocsLayout>
  );
}
