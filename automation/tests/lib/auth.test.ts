import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { bearerAuth } from "../../src/lib/auth.js";

function appWith(expected: string | undefined): Hono {
  const app = new Hono();
  app.use("*", bearerAuth(expected));
  app.get("/ok", (c) => c.json({ ok: true }));
  return app;
}

describe("bearerAuth", () => {
  it("returns 503 when no token is configured (fail-closed)", async () => {
    const res = await appWith(undefined).request("/ok", {
      headers: { Authorization: "Bearer anything" },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: /not configured/ });
  });

  it("returns 401 when no Authorization header is present", async () => {
    const res = await appWith("expected-token").request("/ok");
    expect(res.status).toBe(401);
  });

  it("returns 401 when the bearer token doesn't match", async () => {
    const res = await appWith("expected-token").request("/ok", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("passes through when the bearer token matches", async () => {
    const res = await appWith("expected-token").request("/ok", {
      headers: { Authorization: "Bearer expected-token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects bearer schemes that don't start with 'Bearer '", async () => {
    const res = await appWith("expected-token").request("/ok", {
      headers: { Authorization: "Basic Zm9vOmJhcg==" },
    });
    expect(res.status).toBe(401);
  });
});
