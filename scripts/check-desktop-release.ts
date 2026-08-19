/**
 * Does the published desktop build actually exist?
 *
 * `lib/desktop.ts` can only reason about configuration. It refuses to offer a
 * download without a checksum, which rules out a location nobody has verified —
 * but a checksum is computed from a local file, so it still cannot tell whether
 * that file was ever uploaded. Only asking the host can, and a static page
 * cannot ask at request time because its variables are read at build time.
 *
 * So this asks, on demand, before a deploy:
 *
 *   npm run desktop:check
 *
 * It exits non-zero when a configured artefact is not reachable, which is what
 * makes it usable as a release gate rather than a thing to read and forget.
 *
 * Pass --checksum to download each artefact in full and hash it. That is a few
 * hundred megabytes, so it is not the default, but it is the only check that
 * catches the case that matters most: a file that exists at the right URL and
 * is not the file the site tells people to expect.
 */

import "dotenv/config";
import { createHash } from "node:crypto";
import { candidateUrl, getDesktopRelease, type MacArch } from "../lib/desktop";

const ARCHES: MacArch[] = ["arm64", "x64"];
const verifyChecksums = process.argv.includes("--checksum");

interface Row {
  arch: MacArch;
  url: string | null;
  offered: boolean;
  declaredSha: string | null;
  status: number | null;
  bytes: number | null;
  actualSha: string | null;
  problem: string | null;
}

function human(bytes: number | null): string {
  if (bytes === null) return "—";
  return `${(bytes / 1_000_000).toFixed(0)} MB`;
}

async function head(url: string): Promise<{ status: number; bytes: number | null }> {
  // GitHub redirects release assets to object storage; follow it, since the
  // redirect resolving is not the same as the asset existing.
  const response = await fetch(url, { method: "HEAD", redirect: "follow" });
  const length = response.headers.get("content-length");
  return { status: response.status, bytes: length ? Number(length) : null };
}

async function hash(url: string): Promise<{ sha: string; bytes: number }> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }

  const digest = createHash("sha256");
  let bytes = 0;
  // Streamed rather than buffered: these are ~130 MB each and there is no
  // reason to hold one in memory to hash it.
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    digest.update(chunk);
    bytes += chunk.byteLength;
  }
  return { sha: digest.digest("hex"), bytes };
}

async function inspect(arch: MacArch): Promise<Row> {
  const release = getDesktopRelease();
  const build = release.builds.find((entry) => entry.arch === arch)!;
  const url = candidateUrl(arch);

  const row: Row = {
    arch,
    url,
    offered: build.url !== null,
    declaredSha: build.sha256,
    status: null,
    bytes: null,
    actualSha: null,
    problem: null,
  };

  if (!url) {
    row.problem = "No release tag or explicit URL configured.";
    return row;
  }

  try {
    const result = await head(url);
    row.status = result.status;
    row.bytes = result.bytes;

    if (result.status === 404) {
      row.problem = "Not found. The tag is configured but the asset is not published.";
      return row;
    }
    if (result.status >= 400) {
      row.problem = `Host returned ${result.status}.`;
      return row;
    }
  } catch (error) {
    row.problem = `Unreachable: ${(error as Error).message}`;
    return row;
  }

  if (!row.declaredSha) {
    row.problem = "Reachable, but no checksum is configured, so it is not offered.";
    return row;
  }

  if (verifyChecksums) {
    try {
      const result = await hash(url);
      row.actualSha = result.sha;
      row.bytes = result.bytes;
      if (result.sha !== row.declaredSha.toLowerCase()) {
        row.problem = "Checksum mismatch — the published file is not the one described.";
      }
    } catch (error) {
      row.problem = `Could not hash: ${(error as Error).message}`;
    }
  }

  return row;
}

async function main(): Promise<void> {
  const release = getDesktopRelease();

  console.log(`MERIT Console v${release.version}`);
  console.log(
    verifyChecksums
      ? "Downloading each artefact to verify its checksum.\n"
      : "Checking that each artefact is reachable. Add --checksum to verify contents.\n",
  );

  const rows: Row[] = [];
  for (const arch of ARCHES) {
    rows.push(await inspect(arch));
  }

  for (const row of rows) {
    const mark = row.problem ? "FAIL" : "OK  ";
    console.log(`${mark} ${row.arch}`);
    console.log(`     url    ${row.url ?? "—"}`);
    console.log(`     status ${row.status ?? "—"}   size ${human(row.bytes)}`);
    if (row.actualSha) {
      console.log(`     sha256 ${row.actualSha}`);
      if (row.declaredSha && row.actualSha !== row.declaredSha.toLowerCase()) {
        console.log(`     wanted ${row.declaredSha}`);
      }
    }
    console.log(`     offered on the site: ${row.offered ? "yes" : "no"}`);
    if (row.problem) console.log(`     ${row.problem}`);
    console.log();
  }

  const broken = rows.filter((row) => row.problem !== null);

  if (broken.length === 0) {
    console.log("Every configured artefact is published and reachable.");
    console.log(
      "Remember the landing page is statically rendered: redeploy for a change " +
        "in these variables to reach visitors.",
    );
    return;
  }

  // A build that is not offered and not published is a consistent, honest
  // state — the site says "not published" and it is not published. Only a
  // mismatch between what the site claims and what the host serves is a failure.
  const dishonest = broken.filter((row) => row.offered);

  if (dishonest.length === 0) {
    console.log(
      "Nothing is offered on the site, and nothing is published. Consistent, " +
        "and safe to deploy.",
    );
    return;
  }

  console.error(
    `${dishonest.length} artefact(s) are offered on the site but not correctly ` +
      "published. Visitors would get a broken download.",
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
