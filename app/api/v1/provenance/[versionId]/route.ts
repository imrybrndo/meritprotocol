import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { apiError, clientIdentifier, ok, rateLimit, toErrorResponse, tooManyRequests } from "@/lib/api/http";
import { latestScan, scanHistory } from "@/lib/services/provenance";

export const runtime = "nodejs";

/**
 * GET /api/v1/provenance/:versionId — source provenance for a strategy version.
 *
 * Public and unauthenticated, for the same reason verification is: provenance
 * only a privileged caller could read would let a repository be quietly swapped
 * out of view, which is the thing this endpoint exists to make impossible.
 *
 * `?history=1` returns every scan, newest first. That sequence is the point —
 * a repository that verified in March and is gone in August is a fact the
 * latest scan alone cannot show.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const limit = await rateLimit(`provenance:${clientIdentifier(request)}`);
    if (!limit.allowed) return tooManyRequests(limit);

    const { versionId } = await params;
    const prisma = getPrisma();

    const version = await prisma.strategyVersion.findUnique({
      where: { id: versionId },
      select: { id: true, version: true, repositoryUrl: true, repositoryCommit: true },
    });
    if (!version) {
      return apiError("VERSION_NOT_FOUND", "No strategy version matches this identifier", 404);
    }

    if (!version.repositoryUrl) {
      // Not an error. An agent disclosing no source is a legitimate state, and
      // reporting it plainly is more useful than a 404 that reads like a bug.
      return ok({
        strategyVersionId: version.id,
        version: version.version,
        declared: false,
        note: "This strategy version declares no source repository.",
        scan: null,
      });
    }

    const wantsHistory = ["1", "true"].includes(
      (request.nextUrl.searchParams.get("history") ?? "").toLowerCase(),
    );

    const scan = await latestScan(prisma, version.id);

    return ok({
      strategyVersionId: version.id,
      version: version.version,
      declared: true,
      repository: version.repositoryUrl,
      commitSha: version.repositoryCommit,
      scan: scan
        ? {
            state: scan.state,
            checks: scan.checks,
            commitUrl: scan.commitUrl,
            license: scan.license,
            primaryLanguage: scan.primaryLanguage,
            repoCreatedAt: scan.repoCreatedAt?.toISOString() ?? null,
            lastPushedAt: scan.lastPushedAt?.toISOString() ?? null,
            stars: scan.stars,
            note: scan.note,
            scannedAt: scan.scannedAt.toISOString(),
          }
        : null,
      ...(wantsHistory
        ? {
            history: (await scanHistory(prisma, version.id)).map((entry) => ({
              state: entry.state,
              checks: entry.checks,
              note: entry.note,
              scannedAt: entry.scannedAt.toISOString(),
            })),
          }
        : {}),
      /// Stated in the payload itself so no client can read a passing scan as
      /// proof the agent ran this code.
      establishes:
        "The named repository is publicly readable and contains the pinned commit. It does NOT establish that the agent executed that code.",
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
