/**
 * Which commit is actually serving this.
 *
 * On 1 September 2026 a cutover guard was written, tested, committed and never
 * pushed. Production went on running the build from three days earlier — a
 * build in which `reconcileCount` did not take a cutover date at all — and a
 * physical count of thirteen drawers wrote 3,488,123.87 so'm of fictional
 * spending. The suite was green the whole time. It was green about code that
 * was not running.
 *
 * Nothing in the repo could see that, because everything in the repo describes
 * the working tree. The only thing that can answer "what is deployed" is the
 * deployment, so it says so here. See scripts/check-deployed.mjs.
 *
 * PUBLIC, AND DELIBERATELY BORING. A commit SHA of a public repository is not
 * a secret, and the check has to work without a session — src/middleware.ts
 * exempts this path for that reason. Nothing else is exposed: no environment,
 * no configuration, no keys.
 *
 * Static, not dynamic. These values are fixed at build time, which is exactly
 * what makes them the build's identity, and a lambda per poll would be a cost
 * with no answer attached.
 */
export const dynamic = 'force-static';

export function GET() {
  return Response.json({
    // Set by Vercel at build time. Absent in local dev, which is honest: a dev
    // server is not a deployment and should not claim a SHA.
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    env: process.env.VERCEL_ENV ?? 'local',
  });
}
