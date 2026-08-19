import Link from "next/link";
import { DOC_SECTIONS } from "@/lib/docs/content";

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <div className="mx-auto flex max-w-[1400px] gap-10 px-4 py-10 sm:px-6">
      <aside className="hidden w-56 shrink-0 lg:block">
        <nav className="sticky top-20 space-y-5">
          {DOC_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="mb-1.5 text-2xs font-medium uppercase tracking-[0.14em] text-ink-faint">
                {section.title}
              </div>
              <ul className="space-y-0.5 border-l border-line">
                {section.pages.map((page) => (
                  <li key={page.slug}>
                    <Link
                      href={`/docs/${page.slug}`}
                      className="-ml-px block border-l border-transparent py-1 pl-3 text-xs text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
                    >
                      {page.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
