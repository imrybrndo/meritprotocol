"use client";

import { useCallback } from "react";
import type { AnimationEvent } from "react";
import { DemoCard } from "./demo-card";
import { HeroContent } from "./hero-content";
import { SiteHeader } from "./site-header";
import "./vantage-hero.css";

const BACKGROUND_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260808_064556_051587f1-74a1-4336-8c05-4dde3594ed05.mp4";

export function VantageHero() {
  // The demo card is the last beat of the entrance timeline — when it lands the
  // pending state comes off and the head-script fallback timer is cancelled.
  const handleEntranceEnd = useCallback((event: AnimationEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.animationName !== "entrance-card") return;

    document.documentElement.classList.remove("motion-pending");

    const timeout = window.__vantageMotionFallback;
    if (timeout) {
      window.clearTimeout(timeout);
      window.__vantageMotionFallback = 0;
    }
  }, []);

  return (
    <main className="viewport">
      <section className="screen" id="screen">
        <video
          className="background"
          autoPlay
          muted
          loop
          playsInline
          disablePictureInPicture
          aria-hidden="true"
        >
          <source src={BACKGROUND_VIDEO} type="video/mp4" />
        </video>

        <SiteHeader />

        <section className="hero">
          <HeroContent />
          <DemoCard onEntranceEnd={handleEntranceEnd} />
        </section>
      </section>
    </main>
  );
}
