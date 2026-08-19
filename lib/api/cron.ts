/**
 * Scheduler authentication.
 *
 * The scheduled routes seal batches and write reputation history. Left open
 * they would be a free way to make anyone pay for anchor transactions and to
 * flood the event log, so they are not open.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`, which is the shape
 * accepted here. The same header works from any other scheduler, and from curl
 * during setup, so nothing about this ties the protocol to one host.
 *
 * With no secret configured the routes are refused outright rather than left
 * unauthenticated. A deployment that forgot to set it should stop sealing and
 * say so — the alternative is a public endpoint that spends money, and
 * discovering that from a drained wallet is not an acceptable way to find out.
 * Local development is the one exception, so `npm run dev` works unconfigured.
 */

export class CronAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "CronAuthError";
  }
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Throws unless the request carries the configured scheduler secret. */
export function authorizeCron(request: Request): void {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    if (process.env.NODE_ENV === "development") return;
    throw new CronAuthError(
      "CRON_SECRET is not set. Scheduled routes stay closed until it is.",
      503,
      "CRON_NOT_CONFIGURED",
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!presented || !timingSafeEquals(presented, secret)) {
    throw new CronAuthError("Invalid scheduler credential", 401, "CRON_UNAUTHORIZED");
  }
}
