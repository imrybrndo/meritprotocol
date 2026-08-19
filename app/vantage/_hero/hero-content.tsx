import { ArrowIcon } from "./icons";

export function HeroContent() {
  return (
    <div className="hero-content">
      <h1 className="hero-title">
        <span className="line line-one">
          <span className="line-reveal">Stop Digging</span>
        </span>
        <span className="line line-two">
          <span className="line-reveal">Through Dashboards.</span>
        </span>
      </h1>

      <p className="hero-copy">
        {/* The spaces before each break are collapsed at end of line, and keep
            the words apart at the breakpoints where the <br> is hidden. */}
        Your metrics are scattered across a dozen dashboards.{" "}
        <br />
        Vantage bring them into one clear signal, so every{" "}
        <br />
        decision is backed by data you actually trust.
      </p>

      <button className="primary-cta" type="button">
        <span className="label">Get Started</span>
        <span className="arrow-box">
          <ArrowIcon />
        </span>
      </button>
    </div>
  );
}
