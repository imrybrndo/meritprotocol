import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { authorizeCron } from "@/lib/api/cron";
import { ok, toErrorResponse } from "@/lib/api/http";
import { scanAllVersions } from "@/lib/services/provenance";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/provenance — re-observe every declared source repository.
 *
 * Freezing a commit at registration makes a claim checkable. Only re-checking
 * it catches the claim being withdrawn: a repository deleted or made private
 * after a bad month currently leaves no trace anywhere in the protocol. Each
 * run appends a scan, so the sequence itself becomes the record.
 */
export async function GET(request: NextRequest) {
  try {
    authorizeCron(request);

    const run = await scanAllVersions(getPrisma());

    return ok({
      scanned: run.scanned,
      verified: run.verified,
      /// Versions that verified on the previous run and no longer do. This is
      /// the number worth alerting on.
      regressions: run.regressions,
      tokenConfigured: Boolean(process.env.GITHUB_TOKEN?.trim()),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export const POST = GET;
