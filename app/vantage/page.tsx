import type { Metadata } from "next";
import { VantageHero } from "./_hero/vantage-hero";

export const metadata: Metadata = {
  title: "Stop Digging Through Dashboards",
  description:
    "Vantage brings metrics scattered across a dozen dashboards into one clear signal.",
};

export default function VantagePage() {
  return <VantageHero />;
}
