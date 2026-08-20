/**
 * GitHub source provenance.
 *
 * What this establishes: a named repository exists, is publicly readable, and
 * contains a specific commit. Because a commit SHA is a hash over the whole
 * tree, that last part is a real cryptographic claim — the content behind a SHA
 * cannot change without the SHA changing, so "this version was registered
 * against this code" is checkable by anyone with a clone and no MERIT involved.
 *
 * What it does NOT establish, and what the interface must therefore never
 * imply: that the agent actually ran that code. An operator can link an
 * immaculate repository and run something else entirely. Disclosure is not
 * attestation, and the honest framing is the whole value here — a green tick
 * that overstates what was checked is worse than no tick, because it sells a
 * certainty the protocol does not have.
 *
 * Nothing read here feeds the MERIT score. Star counts are recorded because an
 * operator looking at a scan wants to see them, and for no other reason: they
 * are purchasable, and a purchasable input is precisely what `scoreIntegrity`
 * and the invariant test in tests/reputation.test.ts exist to keep out.
 */

const API = "https://api.github.com";

/** GitHub's own cap: 60 requests an hour unauthenticated, 5000 with a token. */
function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN?.trim();
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "merit-protocol-provenance",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export interface RepositoryRef {
  owner: string;
  name: string;
  /** Normalised "github.com/owner/name". What gets stored and displayed. */
  canonical: string;
}

/**
 * Parse the many shapes of a GitHub URL an operator might paste.
 *
 * Accepts the browser URL, the clone URL with `.git`, the SSH remote, and a
 * bare `owner/name`. Rejects anything that is not GitHub rather than guessing:
 * a URL this cannot read is better refused at registration than stored and
 * scanned forever as UNREACHABLE.
 */
export function parseRepositoryUrl(input: string): RepositoryRef | null {
  const raw = input.trim();
  if (!raw) return null;

  // Strip the scheme, the SSH form, and any credentials.
  const stripped = raw
    .replace(/^git\+/i, "")
    .replace(/^(https?:\/\/|ssh:\/\/)?(git@)?/i, "");

  const hadGitHubHost = /^(www\.)?github\.com[:/]/i.test(stripped);

  // A bare "owner/name" survives the strip untouched, which is intended.
  const segments = stripped
    .replace(/^(www\.)?github\.com[:/]/i, "")
    .replace(/[?#].*$/, "")
    .split("/")
    .filter(Boolean);

  if (segments.length < 2) return null;

  // A host that survived the GitHub strip is a different host. Parsing it into
  // an owner/name pair anyway would store a GitLab project as a GitHub one and
  // scan it forever as missing — which reads as evidence against an agent that
  // disclosed its source perfectly well, just not here.
  if (!hadGitHubHost && segments[0].includes(".")) return null;

  const [owner, name] = segments.map((segment) => segment.replace(/\.git$/i, ""));

  // GitHub's own rules: alphanumerics, hyphen, underscore, dot. Enforced here
  // so a malformed handle becomes a validation error rather than a 404 later.
  const valid = /^[A-Za-z0-9_.-]+$/;
  if (!valid.test(owner) || !valid.test(name)) return null;
  if (owner === "." || owner === ".." || name === "." || name === "..") return null;

  return { owner, name, canonical: `github.com/${owner}/${name}` };
}

export interface RepositoryFacts {
  isPublic: boolean;
  isArchived: boolean;
  license: string | null;
  primaryLanguage: string | null;
  /** No push can rewrite this, which is what makes it worth recording. */
  createdAt: Date | null;
  pushedAt: Date | null;
  stars: number;
  defaultBranch: string;
}

export type FetchOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "missing" | "unreachable"; note: string };

async function call<T>(path: string): Promise<FetchOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      headers: headers(),
      // Provenance is a point-in-time observation; a cached answer would
      // report a repository as present after it was deleted.
      cache: "no-store",
    });
  } catch (error) {
    return { ok: false, kind: "unreachable", note: `Network error: ${(error as Error).message}` };
  }

  if (response.status === 404) {
    // GitHub returns 404 rather than 403 for a private repository, so this is
    // "gone or hidden" — the two are indistinguishable from outside, and the
    // scan should not pretend to tell them apart.
    return { ok: false, kind: "missing", note: "Not found. Deleted, renamed, or made private." };
  }

  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    return {
      ok: false,
      kind: "unreachable",
      note:
        remaining === "0"
          ? "GitHub API rate limit reached. Set GITHUB_TOKEN to raise it from 60 to 5000 requests an hour."
          : "GitHub refused the request.",
    };
  }

  if (!response.ok) {
    return { ok: false, kind: "unreachable", note: `GitHub returned ${response.status}.` };
  }

  return { ok: true, value: (await response.json()) as T };
}

interface RepoResponse {
  private: boolean;
  archived: boolean;
  license: { spdx_id: string | null; name: string } | null;
  language: string | null;
  created_at: string | null;
  pushed_at: string | null;
  stargazers_count: number;
  default_branch: string;
}

export async function fetchRepository(ref: RepositoryRef): Promise<FetchOutcome<RepositoryFacts>> {
  const result = await call<RepoResponse>(`/repos/${ref.owner}/${ref.name}`);
  if (!result.ok) return result;

  const repo = result.value;

  return {
    ok: true,
    value: {
      // Reaching this at all means the API answered, which for an unauthenticated
      // request means the repository is public. With a token it could be a
      // private repository the token can see — recorded honestly either way.
      isPublic: !repo.private,
      isArchived: repo.archived,
      license: repo.license?.spdx_id ?? repo.license?.name ?? null,
      primaryLanguage: repo.language,
      createdAt: repo.created_at ? new Date(repo.created_at) : null,
      pushedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
      stars: repo.stargazers_count,
      defaultBranch: repo.default_branch,
    },
  };
}

/**
 * Resolve a ref — branch, tag, or SHA — to the full commit SHA.
 *
 * Called once, at registration. Resolving on every read would defeat the point:
 * the whole reason to store a SHA is that a branch name moves and a SHA does not.
 */
export async function resolveCommit(
  ref: RepositoryRef,
  gitRef?: string,
): Promise<FetchOutcome<string>> {
  const target = gitRef?.trim() || "HEAD";
  const result = await call<{ sha: string }>(
    `/repos/${ref.owner}/${ref.name}/commits/${encodeURIComponent(target)}`,
  );

  if (!result.ok) return result;
  return { ok: true, value: result.value.sha };
}

/**
 * Is this commit still present in this repository?
 *
 * The question a scan actually asks. A force-push or a history rewrite can
 * remove a commit from a repository that still exists, and that is a different
 * fact from the repository being gone.
 */
export async function commitPresent(
  ref: RepositoryRef,
  sha: string,
): Promise<FetchOutcome<boolean>> {
  const result = await call<{ sha: string }>(
    `/repos/${ref.owner}/${ref.name}/commits/${encodeURIComponent(sha)}`,
  );

  if (result.ok) return { ok: true, value: result.value.sha === sha };
  if (result.kind === "missing") return { ok: true, value: false };
  return result;
}

/** A full 40-character hex commit SHA. */
export function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value.trim().toLowerCase());
}

/** Browser URL for a pinned commit, so a reader can go and look. */
export function commitUrl(canonical: string, sha: string): string {
  return `https://${canonical}/commit/${sha}`;
}
