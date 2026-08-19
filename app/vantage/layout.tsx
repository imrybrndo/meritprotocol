"use client";

import { useEffect } from "react";

/**
 * The Vantage composition is a full-viewport, non-scrolling screen. It locks the
 * document only while this route is mounted so the rest of MERIT keeps normal
 * document flow.
 */
export default function VantageLayout({ children }: LayoutProps<"/vantage">) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("vantage-lock");
    return () => root.classList.remove("vantage-lock");
  }, []);

  return children;
}
