"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrandMark, MenuIcon } from "./icons";

const NAV_LINKS = ["Home", "About", "Services", "Contact"] as const;

export function SiteHeader() {
  const headerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsible, setCollapsible] = useState(false);

  // The toggle is only rendered as a visible control at the tablet/mobile
  // breakpoints; that is also the only time the panel should be inert.
  useEffect(() => {
    const toggle = toggleRef.current;
    if (!toggle) return;

    const sync = () => {
      const visible = getComputedStyle(toggle).display !== "none";
      setCollapsible(visible);
      if (!visible) setMenuOpen(false);
    };

    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  // The panel is only focusable once its style is recalculated with the open
  // class, so reach for the link on the frame after the commit.
  useEffect(() => {
    if (!menuOpen) return;
    const frame = requestAnimationFrame(() => firstLinkRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [menuOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <header
      ref={headerRef}
      className={menuOpen ? "header menu-open" : "header"}
      data-menu-open={menuOpen}
    >
      <a className="brand" href="#" aria-label="Vantage home">
        <BrandMark />
      </a>

      <div
        className="header-actions"
        id="tablet-navigation"
        inert={collapsible && !menuOpen}
      >
        <nav className="nav" aria-label="Primary">
          {NAV_LINKS.map((link, index) => (
            <a
              key={link}
              ref={index === 0 ? firstLinkRef : undefined}
              className={index === 0 ? "active" : undefined}
              aria-current={index === 0 ? "page" : undefined}
              href="#"
              onClick={closeMenu}
            >
              {link}
            </a>
          ))}
        </nav>

        <div className="time-panel">
          <span className="label">Timezone</span>
          <span className="value">{"9:47 PM\u00a0 \u2022 \u00a014 July 2026"}</span>
        </div>

        <button className="sign-up" type="button">
          <span>Sign Up</span>
        </button>
      </div>

      <button
        ref={toggleRef}
        className="menu-toggle"
        type="button"
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        aria-controls="tablet-navigation"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <MenuIcon />
      </button>
    </header>
  );
}
