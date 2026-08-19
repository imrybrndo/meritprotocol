import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dmgFilename, getDesktopRelease } from "@/lib/desktop";

/**
 * The download section is the one place on the site that hands a visitor a
 * binary, so the rule it enforces is narrow and worth pinning: a button appears
 * only when the URL behind it can actually resolve off the deployment. Every
 * regression here ships a link that 404s in production and nowhere else.
 *
 * The rule tightened after a tag alone proved to be enough to render a button
 * pointing at a release that did not exist. A location plus a checksum is the
 * requirement now, so most of these cases set both.
 */

/** A real digest shape; the value itself is never checked against a file here. */
const SHA_ARM = "594fa5fb9ee5fa878d379c7eea3e6cbc7fd3c064fc913d86b7e0753ea70fba2c";
const SHA_X64 = "c2b6caa5a05d21f6d404deb1137977d7ee13944f9d3d15161237ca5d49053f03";

/** Both checksums set, which is the normal state of a published release. */
function withChecksums(): void {
  process.env.MERIT_DESKTOP_MAC_ARM64_SHA256 = SHA_ARM;
  process.env.MERIT_DESKTOP_MAC_X64_SHA256 = SHA_X64;
}

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

  it("derives both architecture URLs from a release tag", () => {
    process.env.MERIT_DESKTOP_RELEASE_TAG = "v0.1.0";
    withChecksums();

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
    withChecksums();

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
    withChecksums();

    expect(arm64().url).toContain("github.com/imrybrndo/meritprotocol");
    expect(x64().url).toBe("https://cdn.example.com/intel.dmg");
  });

  it("publishes on an explicit URL with no tag configured", () => {
    process.env.MERIT_DESKTOP_MAC_ARM64_URL = "https://cdn.example.com/a.dmg";
    process.env.MERIT_DESKTOP_MAC_ARM64_SHA256 = SHA_ARM;

    const release = getDesktopRelease();
    expect(release.available).toBe(true);
    expect(arm64().url).toBe("https://cdn.example.com/a.dmg");
    expect(x64().url).toBeNull();
  });

  /**
   * The regression this rule was added for. A tag was set to `v0.1.0`, no such
   * release existed, and the site rendered two working-looking buttons onto a
   * 404. Configuration is intent; a digest is evidence.
   */
  it("refuses a tag with no checksum, however plausible the tag looks", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.MERIT_DESKTOP_RELEASE_TAG = "v0.1.0";

    const release = getDesktopRelease();
    expect(release.available).toBe(false);
    expect(arm64().url).toBeNull();
    expect(x64().url).toBeNull();
  });

  it("offers only the architecture whose checksum is present", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.MERIT_DESKTOP_RELEASE_TAG = "v0.1.0";
    process.env.MERIT_DESKTOP_MAC_ARM64_SHA256 = SHA_ARM;

    const release = getDesktopRelease();
    expect(release.available).toBe(true);
    expect(arm64().url).not.toBeNull();
    expect(x64().url).toBeNull();
  });

  it("still reports the release notes for an unpublished tag", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.MERIT_DESKTOP_RELEASE_TAG = "v0.1.0";

    // The notes link is not a download, so withholding it would hide the
    // release page from someone who wants to build from source.
    expect(getDesktopRelease().notesUrl).toBe(
      "https://github.com/imrybrndo/meritprotocol/releases/tag/v0.1.0",
    );
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
    withChecksums();

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
