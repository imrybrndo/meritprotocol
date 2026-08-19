/**
 * Release metadata for the MERIT Console desktop build.
 *
 * The landing page must not offer a download that does not exist — for the
 * same reason the registry never renders invented numbers. A dead link is a
 * claim the product cannot back. Until a build is published and its location is
 * configured, the download section says so plainly and shows how to build from
 * source instead.
 *
 * There are two ways to configure it, and the first is the one to use:
 *
 *  1. Set `MERIT_DESKTOP_RELEASE_TAG` to the Git tag of a published GitHub
 *     release (e.g. `v0.1.0`). Both architecture URLs are then derived from the
 *     same `artifactName` pattern electron-builder writes, so one variable
 *     publishes the whole release. `MERIT_DESKTOP_RELEASE_REPO` overrides the
 *     repository if the artefacts live somewhere other than the default below.
 *
 *  2. Point `MERIT_DESKTOP_MAC_ARM64_URL` / `MERIT_DESKTOP_MAC_X64_URL` at
 *     hosted artefacts directly — an object-store URL, or a release asset whose
 *     name does not follow the pattern. An explicit URL always wins over a
 *     derived one, so a single re-uploaded architecture can be redirected
 *     without disturbing the other.
 *
 * A configured location is not the same as a published file, so a build only
 * counts as available when its **checksum** is also set. The tag alone was not
 * enough: it is a string an operator types, and typing it rendered a working
 * download button whether or not the release existed — which is how this
 * project shipped a button pointing at a 404. A checksum cannot be typed from
 * intent. Producing one means holding the artefact and hashing it, which is the
 * strongest evidence available without a network call at build time. It is not
 * proof the file was uploaded; `npm run desktop:check` is, and it is worth
 * running before a deploy.
 *
 * Either way the artefact is hosted off the deployment. Site-relative paths are
 * rejected on purpose, and the reason is a failure that already happened:
 * `/downloads/x.dmg` looks configured, renders a button, and then 404s in
 * production — because disk images are excluded from both Git and the
 * deployment (see `.vercelignore`), so they exist on the developer's machine
 * and nowhere else. A path that can only resolve on localhost is worse than no
 * path at all, since it is indistinguishable from a working one until a visitor
 * clicks it.
 *
 * One deployment note that is easy to lose an afternoon to: the landing page is
 * statically rendered, so these variables are read when the build runs, not
 * when a visitor arrives. Adding them in the Vercel dashboard changes nothing
 * until the next deploy — redeploy after setting them.
 */

export type MacArch = "arm64" | "x64";

/** Where releases are published unless `MERIT_DESKTOP_RELEASE_REPO` says otherwise. */
const DEFAULT_RELEASE_REPO = "imrybrndo/meritprotocol";

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

let warned = false;

/**
 * An explicitly configured artefact URL, or null. Only absolute http(s) URLs
 * count as published.
 */
function artefactUrl(name: string): string | null {
  const value = env(name);
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;

  if (!warned) {
    warned = true;
    console.warn(
      `[desktop] ${name} is set to "${value}", which is not an absolute URL. ` +
        "Disk images are not served from the deployment, so a site-relative path " +
        "404s in production. Publish the build and point this at the hosted file. " +
        "Treating it as unpublished.",
    );
  }
  return null;
}

/**
 * The name electron-builder gives the disk image.
 *
 * This must stay in step with `artifactName` in `desktop/package.json`; the
 * derived release URLs are built from it, and a mismatch produces a button that
 * 404s — the exact failure the absolute-URL rule exists to prevent.
 */
export function dmgFilename(version: string, arch: MacArch): string {
  return `MERIT-${version}-${arch}.dmg`;
}

/**
 * The GitHub release asset URL for one architecture, when a tag is configured.
 */
function releaseAssetUrl(
  tag: string,
  version: string,
  arch: MacArch,
): string {
  const repo = env("MERIT_DESKTOP_RELEASE_REPO") ?? DEFAULT_RELEASE_REPO;
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(
    tag,
  )}/${dmgFilename(version, arch)}`;
}

/**
 * The version the artefacts are named after.
 *
 * `MERIT_DESKTOP_VERSION` wins; otherwise a `v`-prefixed tag carries it, which
 * is the usual case since the tag is cut from the package version.
 */
function resolveVersion(tag: string | null): string {
  const explicit = env("MERIT_DESKTOP_VERSION");
  if (explicit) return explicit;
  if (tag && /^v\d/.test(tag)) return tag.slice(1);
  return "0.1.0";
}

/**
 * The URL a build would be served from, published or not.
 *
 * Exported for `scripts/check-desktop-release.ts`, which is the only thing that
 * can settle whether the file is actually there.
 */
export function candidateUrl(arch: MacArch): string | null {
  const tag = env("MERIT_DESKTOP_RELEASE_TAG");
  const explicit = artefactUrl(
    arch === "arm64" ? "MERIT_DESKTOP_MAC_ARM64_URL" : "MERIT_DESKTOP_MAC_X64_URL",
  );
  if (explicit) return explicit;
  return tag ? releaseAssetUrl(tag, resolveVersion(tag), arch) : null;
}

let unverifiedWarned = false;

/**
 * Withhold a download that nobody can check.
 *
 * Returning null here is what turns the button into "Not published" rather than
 * into a link nobody has verified.
 */
function publishedUrl(arch: MacArch, sha256: string | null): string | null {
  const url = candidateUrl(arch);
  if (!url) return null;
  if (sha256) return url;

  if (!unverifiedWarned) {
    unverifiedWarned = true;
    console.warn(
      `[desktop] A ${arch} artefact location is configured but its SHA-256 is not. ` +
        "A download nobody can check against a published digest is not offered — " +
        "set MERIT_DESKTOP_MAC_" +
        arch.toUpperCase() +
        "_SHA256 to the output of `shasum -a 256` on the file you uploaded. " +
        "Treating it as unpublished.",
    );
  }
  return null;
}

export function getDesktopRelease(): DesktopRelease {
  const tag = env("MERIT_DESKTOP_RELEASE_TAG");
  const version = resolveVersion(tag);

  const armSha = env("MERIT_DESKTOP_MAC_ARM64_SHA256");
  const x64Sha = env("MERIT_DESKTOP_MAC_X64_SHA256");

  const builds: DesktopBuild[] = [
    {
      arch: "arm64",
      label: "Apple Silicon",
      hardware: "M1 and later",
      url: publishedUrl("arm64", armSha),
      size: env("MERIT_DESKTOP_MAC_ARM64_SIZE"),
      sha256: armSha,
    },
    {
      arch: "x64",
      label: "Intel",
      hardware: "x86-64 Macs",
      url: publishedUrl("x64", x64Sha),
      size: env("MERIT_DESKTOP_MAC_X64_SIZE"),
      sha256: x64Sha,
    },
  ];

  return {
    version,
    minimumOs: env("MERIT_DESKTOP_MIN_MACOS") ?? "macOS 12 Monterey",
    format: "Apple Disk Image (.dmg)",
    builds,
    available: builds.some((build) => build.url !== null),
    notesUrl:
      env("MERIT_DESKTOP_RELEASE_NOTES_URL") ??
      (tag
        ? `https://github.com/${
            env("MERIT_DESKTOP_RELEASE_REPO") ?? DEFAULT_RELEASE_REPO
          }/releases/tag/${encodeURIComponent(tag)}`
        : null),
  };
}
