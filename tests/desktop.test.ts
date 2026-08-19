import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dmgFilename, getDesktopRelease } from "@/lib/desktop";

/**
 * The download section is the one place on the site that hands a visitor a
 * binary, so the rule it enforces is narrow and worth pinning: a button appears
 * only when the URL behind it can actually resolve off the deployment. Every
 * regression here ships a link that 404s in production and nowhere else.
 */

const VARS = [
  "MERIT_DESKTOP_RELEASE_TAG",
  "MERIT_DESKTOP_RELEASE_REPO",
  "MERIT_DESKTOP_RELEASE_NOTES_URL",
  "MERIT_DESKTOP_VERSION",
  "MERIT_DESKTOP_MIN_MACOS",
  "MERIT_DESKTOP_MAC_ARM64_URL",
  "MERIT_DESKTOP_MAC_X64_URL",
  "MERIT_DESKTOP_MAC_ARM64_SIZE",
  "MERIT_DESKTOP_MAC_X64_SIZE",
  "MERIT_DESKTOP_MAC_ARM64_SHA256",
  "MERIT_DESKTOP_MAC_X64_SHA256",
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of VARS) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
  vi.restoreAllMocks();
});

const arm64 = () => getDesktopRelease().builds.find((b) => b.arch === "arm64")!;
const x64 = () => getDesktopRelease().builds.find((b) => b.arch === "x64")!;

describe("getDesktopRelease", () => {
  it("reports nothing published when the environment is empty", () => {
    const release = getDesktopRelease();
    expect(release.available).toBe(false);
    expect(release.builds.every((build) => build.url === null)).toBe(true);
    expect(release.notesUrl).toBeNull();
  });

  it("derives both architecture URLs from a release tag alone", () => {
    process.env.MERIT_DESKTOP_RELEASE_TAG = "v0.1.0";

    const release = getDesktopRelease();
    expect(release.available).toBe(true);
    expect(release.version).toBe("0.1.0");
    expect(arm64().url).toBe(
      "https://github.com/imrybrndo/meritprotocol/releases/download/v0.1.0/MERIT-0.1.0-arm64.dmg",
    );
    expect(x64().url).toBe(
      "https://github.com/imrybrndo/meritprotocol/releases/download/v0.1.0/MERIT-0.1.0-x64.dmg",
    );
    expect(release.notesUrl).toBe(
      "https://github.com/imrybrndo/meritprotocol/releases/tag/v0.1.0",
    );
  });

  it("derives against a repository override", () => {
    process.env.MERIT_DESKTOP_RELEASE_TAG = "v2.0.0";
    process.env.MERIT_DESKTOP_RELEASE_REPO = "acme/console";

    expect(arm64().url).toBe(
      "https://github.com/acme/console/releases/download/v2.0.0/MERIT-2.0.0-arm64.dmg",
    );
  });

  it("names artefacts the way electron-builder does", () => {
    // Mirrors `artifactName` in desktop/package.json. If that changes, this
    // fails here rather than as a 404 in front of a visitor.
    expect(dmgFilename("0.1.0", "arm64")).toBe("MERIT-0.1.0-arm64.dmg");
    expect(dmgFilename("1.2.3", "x64")).toBe("MERIT-1.2.3-x64.dmg");
  });

  it("lets an explicit URL override the derived one, per architecture", () => {
    process.env.MERIT_DESKTOP_RELEASE_TAG = "v0.1.0";
    process.env.MERIT_DESKTOP_MAC_X64_URL = "https://cdn.example.com/intel.dmg";

    expect(arm64().url).toContain("github.com/imrybrndo/meritprotocol");
    expect(x64().url).toBe("https://cdn.example.com/intel.dmg");
  });

  it("publishes on an explicit URL with no tag configured", () => {
    process.env.MERIT_DESKTOP_MAC_ARM64_URL = "https://cdn.example.com/a.dmg";

    const release = getDesktopRelease();
    expect(release.available).toBe(true);
    expect(arm64().url).toBe("https://cdn.example.com/a.dmg");
    expect(x64().url).toBeNull();
  });

  it("refuses a site-relative path, which cannot resolve in production", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.MERIT_DESKTOP_MAC_ARM64_URL = "/downloads/MERIT.dmg";

    const release = getDesktopRelease();
    expect(arm64().url).toBeNull();
    expect(release.available).toBe(false);
  });

  it("prefers an explicit version over the one carried by the tag", () => {
    process.env.MERIT_DESKTOP_RELEASE_TAG = "release-candidate";
    process.env.MERIT_DESKTOP_VERSION = "0.2.0";

    const release = getDesktopRelease();
    expect(release.version).toBe("0.2.0");
    expect(arm64().url).toBe(
      "https://github.com/imrybrndo/meritprotocol/releases/download/release-candidate/MERIT-0.2.0-arm64.dmg",
    );
  });

  it("carries size and checksum through only when supplied", () => {
    process.env.MERIT_DESKTOP_RELEASE_TAG = "v0.1.0";
    process.env.MERIT_DESKTOP_MAC_ARM64_SIZE = "121 MB";
    process.env.MERIT_DESKTOP_MAC_ARM64_SHA256 = "a".repeat(64);

    expect(arm64().size).toBe("121 MB");
    expect(arm64().sha256).toBe("a".repeat(64));
    expect(x64().size).toBeNull();
    expect(x64().sha256).toBeNull();
  });

  it("treats a blank variable as unset rather than as a value", () => {
    process.env.MERIT_DESKTOP_RELEASE_TAG = "   ";

    expect(getDesktopRelease().available).toBe(false);
  });
});
