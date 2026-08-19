import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Eyebrow, Panel, Table, Td, Th } from "@/components/ui/primitives";
import { DOC_INDEX, DOC_SECTIONS, findDoc, type DocBlock } from "@/lib/docs/content";

export function generateStaticParams() {
  return [{ slug: [] as string[] }, ...DOC_INDEX.map((page) => ({ slug: [page.slug] }))];
}

export async function generateMetadata({
  params,
}: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const { slug } = await params;
  if (!slug?.length) return { title: "Documentation" };

  const found = findDoc(slug[0]);
  return found
    ? { title: found.page.title, description: found.page.summary }
    : { title: "Documentation" };
}

export default async function DocsPage({ params }: PageProps<"/docs/[[...slug]]">) {
  const { slug } = await params;

  if (!slug?.length) return <DocsIndex />;

  const found = findDoc(slug[0]);
  if (!found) notFound();

  const { page, section } = found;
  const flat = DOC_INDEX;
  const index = flat.findIndex((entry) => entry.slug === page.slug);
  const previous = flat[index - 1];
  const next = flat[index + 1];

  return (
    <article className="max-w-3xl">
      <Eyebrow>{section.title}</Eyebrow>
      <h1 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-ink">
        {page.title}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">{page.summary}</p>

      <div className="mt-8 space-y-5">
        {page.blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>

      <nav className="mt-14 flex justify-between gap-4 border-t border-line pt-5">
        {previous ? (
          <Link href={`/docs/${previous.slug}`} className="text-xs text-ink-dim hover:text-ink">
            ← {previous.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/docs/${next.slug}`} className="text-right text-xs text-ink-dim hover:text-ink">
            {next.title} →
          </Link>
        ) : null}
      </nav>
    </article>
  );
}

function Block({ block }: { block: DocBlock }) {
  switch (block.type) {
    case "h3":
      return (
        <h2 className="pt-4 text-base font-medium tracking-[-0.01em] text-ink">
          {block.text}
        </h2>
      );

    case "p":
      return <p className="text-sm leading-relaxed text-ink-muted">{block.text}</p>;

    case "ul":
      return (
        <ul className="space-y-1.5">
          {block.items?.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-ink-muted">
              <span className="mt-2.5 h-px w-3 shrink-0 bg-ink-faint" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );

    case "code":
      return (
        <Panel className="overflow-hidden">
          <pre className="overflow-x-auto p-4 font-mono text-2xs leading-relaxed text-ink-muted">
            <code>{block.text}</code>
          </pre>
        </Panel>
      );

    case "note":
      return (
        <div className="border-l-2 border-signal bg-signal-wash px-4 py-3">
          <p className="text-xs leading-relaxed text-ink-muted">{block.text}</p>
        </div>
      );

    case "table":
      return (
        <Panel>
          <Table>
            <thead>
              <tr>
                {block.head?.map((cell) => (
                  <Th key={cell}>{cell}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows?.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <Td
                      key={j}
                      className={
                        j === 0 ? "text-xs text-ink" : "text-xs text-ink-muted"
                      }
                    >
                      {cell}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      );

    default:
      return null;
  }
}

function DocsIndex() {
  return (
    <div className="max-w-3xl">
      <Eyebrow>Documentation</Eyebrow>
      <h1 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-ink">
        MERIT Protocol
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        How decisions become proofs, how proofs become reputation, and — just as
        importantly — what none of it establishes.
      </p>

      <div className="mt-10 space-y-8">
        {DOC_SECTIONS.map((section) => (
          <div key={section.title}>
            <h2 className="text-2xs font-medium uppercase tracking-[0.14em] text-ink-faint">
              {section.title}
            </h2>
            <div className="mt-3 grid gap-px bg-line sm:grid-cols-2">
              {section.pages.map((page) => (
                <Link
                  key={page.slug}
                  href={`/docs/${page.slug}`}
                  className="group bg-surface p-4 transition-colors hover:bg-raised"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-ink">{page.title}</span>
                    <ArrowRight
                      size={13}
                      className="shrink-0 text-ink-faint transition-colors group-hover:text-signal"
                    />
                  </div>
                  <p className="mt-1 text-2xs leading-relaxed text-ink-dim">
                    {page.summary}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
