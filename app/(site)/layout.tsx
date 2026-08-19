import { SiteFooter, SiteHeader } from "@/components/merit/site-chrome";

/**
 * Chrome for every MERIT surface. The /vantage route sits outside this group
 * because it is a full-viewport composition with its own shell.
 */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
