import type { VercelConfig } from "@vercel/config/v1";

/**
 * Deployment configuration.
 *
 * The two schedules below are what make the protocol close its own loop. Both
 * routes are guarded by `CRON_SECRET` — see `lib/api/cron.ts` — and both are
 * safe to run when there is nothing to do, which is most of the time.
 *
 * Cadence is not the sealing policy. These schedules decide how often the
 * question is asked; `MERIT_SEAL_MIN_BATCH` and `MERIT_SEAL_MAX_AGE_MINUTES`
 * decide the answer. Running the check every ten minutes costs one indexed
 * count and lets the age trigger be accurate to within ten minutes; raising the
 * thresholds, not the interval, is how you seal less often.
 *
 * Note for Hobby projects: cron frequency is capped there, so a ten-minute
 * schedule is rejected and hourly is the closest equivalent. The age threshold
 * then becomes the effective granularity.
 */
export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "prisma generate && next build",
  crons: [
    { path: "/api/cron/seal", schedule: "*/10 * * * *" },
    // Reputation is derived from sealed proofs, so it runs after sealing has
    // had a chance to land rather than racing it on the same tick.
    { path: "/api/cron/reputation", schedule: "5 * * * *" },
    // Source repositories change far more slowly than trading records, and the
    // unauthenticated GitHub budget is 60 requests an hour. Daily is plenty to
    // catch a repository being withdrawn.
    { path: "/api/cron/provenance", schedule: "20 3 * * *" },
  ],
};

export default config;
