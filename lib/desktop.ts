/**
 * Release metadata for the MERIT Console desktop build.
 *
 * The landing page must not offer a download that does not exist — for the
 * same reason the registry never renders invented numbers. A dead link is a
 * claim the product cannot back. Until a build is published and its URL is
 * configured, the download section says so plainly and shows how to build from
 * source instead.
 *
 * Configure by pointing each architecture at a hosted artefact: a GitHub
 * release asset, an object-store URL, or a file dropped in `public/downloads/`
 * and referenced as `/downloads/<name>.dmg`.
 */

export type MacArch = "arm64" | "x64";

export interface DesktopBuild {
  arch: MacArch;
  /** What the user recognises on the About This Mac screen. */
  label: string;
  hardware: string;
  url: string | null;
  /** Human-readable, e.g. "118 MB". Shown only when the publisher supplies it. */
  size: string | null;
  sha256: string | null;
}

export interface DesktopRelease {
  version: string;
  minimumOs: string;
  format: string;
  builds: DesktopBuild[];
  /** True when at least one architecture has a real artefact behind it. */
  available: boolean;
  notesUrl: string | null;
}

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getDesktopRelease(): DesktopRelease {
  const builds: DesktopBuild[] = [
    {
      arch: "arm64",
      label: "Apple Silicon",
      hardware: "M1 and later",
      url: env("MERIT_DESKTOP_MAC_ARM64_URL"),
      size: env("MERIT_DESKTOP_MAC_ARM64_SIZE"),
      sha256: env("MERIT_DESKTOP_MAC_ARM64_SHA256"),
    },
    {
      arch: "x64",
      label: "Intel",
      hardware: "x86-64 Macs",
      url: env("MERIT_DESKTOP_MAC_X64_URL"),
      size: env("MERIT_DESKTOP_MAC_X64_SIZE"),
      sha256: env("MERIT_DESKTOP_MAC_X64_SHA256"),
    },
  ];

  return {
    version: env("MERIT_DESKTOP_VERSION") ?? "0.1.0",
    minimumOs: env("MERIT_DESKTOP_MIN_MACOS") ?? "macOS 12 Monterey",
    format: "Apple Disk Image (.dmg)",
    builds,
    available: builds.some((build) => build.url !== null),
    notesUrl: env("MERIT_DESKTOP_RELEASE_NOTES_URL"),
  };
}

/** The file a published build is expected to be named, used in the docs copy. */
export function dmgFilename(version: string, arch: MacArch): string {
  return `MERIT-Console-${version}-${arch}.dmg`;
}
