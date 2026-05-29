import type { MiddlewareHandler } from "hono";

// Bearer-token middleware. Fail-closed: if no token is configured, every
// /admin/* request is refused with 503 so an accidental empty
// ADMIN_BEARER_TOKEN env var can't open the surface unintentionally.
//
// v0-shape — swap for SSO / OIDC once team auth is sorted.
export function bearerAuth(expected: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (!expected) {
      return c.json(
        {
          ok: false,
          error: "admin auth not configured",
          hint: "Set ADMIN_BEARER_TOKEN to enable the admin surface.",
        },
        503,
      );
    }
    const header = c.req.header("Authorization") ?? "";
    const match = /^Bearer\s+(.+)$/.exec(header);
    if (!match || match[1] !== expected) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    return next();
  };
}
