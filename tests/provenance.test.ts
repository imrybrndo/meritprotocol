/**
 * Source provenance.
 *
 * The URL parser carries more weight than it looks like it should. It is the
 * only thing standing between "an operator pasted something" and a permanent,
 * publicly displayed claim about where an agent's code lives, and both failure
 * directions are bad: rejecting a valid remote blocks an honest disclosure,
 * while accepting a malformed one stores a reference that can never resolve and
 * gets scanned as UNREACHABLE forever.
 *
 * No network here. The GitHub calls are exercised against the real API only in
 * the integration suite; these are the decisions made before and after it.
 */

import { describe, expect, it } from "vitest";
import {
  commitUrl,
  isCommitSha,
  parseRepositoryUrl,
} from "@/lib/provenance/github";

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

describe("repository URL parsing", () => {
  it("reads the shapes an operator actually pastes", () => {
    const forms = [
      "https://github.com/merit/agent",
      "http://github.com/merit/agent",
      "https://github.com/merit/agent/",
      "https://github.com/merit/agent.git",
      "git@github.com:merit/agent.git",
      "ssh://git@github.com/merit/agent",
      "github.com/merit/agent",
      "merit/agent",
      "  https://github.com/merit/agent  ",
    ];

    for (const form of forms) {
      expect(parseRepositoryUrl(form)?.canonical, form).toBe("github.com/merit/agent");
    }
  });

  it("ignores the deep-link tail of a URL copied from the browser", () => {
    expect(parseRepositoryUrl("https://github.com/merit/agent/tree/main/src")?.canonical).toBe(
      "github.com/merit/agent",
    );
    expect(parseRepositoryUrl("https://github.com/merit/agent?tab=readme")?.canonical).toBe(
      "github.com/merit/agent",
    );
    expect(parseRepositoryUrl("https://github.com/merit/agent#install")?.canonical).toBe(
      "github.com/merit/agent",
    );
  });

  it("splits owner and name", () => {
    const ref = parseRepositoryUrl("https://github.com/merit/agent");
    expect(ref?.owner).toBe("merit");
    expect(ref?.name).toBe("agent");
  });

  it("keeps names containing dots, hyphens and underscores", () => {
    expect(parseRepositoryUrl("merit/agent.core")?.name).toBe("agent.core");
    expect(parseRepositoryUrl("merit/agent-v2")?.name).toBe("agent-v2");
    expect(parseRepositoryUrl("merit/agent_v2")?.name).toBe("agent_v2");
  });

  /**
   * `.git` is stripped from the end only. A repository legitimately named
   * something like `dotgit` must survive intact.
   */
  it("strips a trailing .git without eating a name that contains it", () => {
    expect(parseRepositoryUrl("merit/agent.git")?.name).toBe("agent");
    expect(parseRepositoryUrl("merit/dotgit")?.name).toBe("dotgit");
  });

  it("refuses input that is not a repository reference", () => {
    for (const bad of ["", "   ", "github.com", "merit", "https://github.com/merit"]) {
      expect(parseRepositoryUrl(bad), bad).toBeNull();
    }
  });

  /**
   * Rejected rather than guessed. A GitLab or Bitbucket URL parsed into an
   * `owner/name` pair would be stored, scanned against GitHub, and reported as
   * missing — which reads as evidence against an agent that did nothing wrong.
   */
  it("refuses a non-GitHub host instead of misreading it", () => {
    expect(parseRepositoryUrl("https://gitlab.com/merit/agent")).toBeNull();
    expect(parseRepositoryUrl("https://bitbucket.org/merit/agent")).toBeNull();
    expect(parseRepositoryUrl("https://example.com/merit/agent")).toBeNull();
  });

  it("refuses path traversal in either segment", () => {
    expect(parseRepositoryUrl("../agent")).toBeNull();
    expect(parseRepositoryUrl("merit/..")).toBeNull();
    expect(parseRepositoryUrl("merit/age nt")).toBeNull();
  });
});

describe("commit SHA recognition", () => {
  it("accepts a full lowercase SHA", () => {
    expect(isCommitSha(SHA)).toBe(true);
  });

  it("accepts an upper-case SHA by normalising it", () => {
    expect(isCommitSha(SHA.toUpperCase())).toBe(true);
  });

  /**
   * A short SHA is not a pin. It is a prefix, it can become ambiguous as a
   * repository grows, and treating it as fixed content would be wrong.
   */
  it("rejects an abbreviated SHA", () => {
    expect(isCommitSha(SHA.slice(0, 7))).toBe(false);
    expect(isCommitSha(SHA.slice(0, 39))).toBe(false);
  });

  it("rejects a branch name, which moves", () => {
    expect(isCommitSha("main")).toBe(false);
    expect(isCommitSha("HEAD")).toBe(false);
    expect(isCommitSha("v1.0.0")).toBe(false);
  });

  it("rejects non-hex of the right length", () => {
    expect(isCommitSha("z".repeat(40))).toBe(false);
  });
});

describe("commit links", () => {
  it("points at the pinned commit, not the branch", () => {
    expect(commitUrl("github.com/merit/agent", SHA)).toBe(
      `https://github.com/merit/agent/commit/${SHA}`,
    );
  });
});
