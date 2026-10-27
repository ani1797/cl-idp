import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/[...path]/route";

describe("public /api proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("serves the backend OpenAPI schema at the documented URL", async () => {
    vi.stubEnv("API_BASE_URL", "https://backend.example/");
    const schema = { openapi: "3.1.0", servers: [{ url: "/api" }] };
    const fetchBackend = vi.fn().mockResolvedValue(Response.json(schema));
    vi.stubGlobal("fetch", fetchBackend);

    const response = await GET(
      new NextRequest("https://idp.example/api/openapi.json"),
      { params: Promise.resolve({ path: ["openapi.json"] }) },
    );

    expect(fetchBackend).toHaveBeenCalledWith(
      "https://backend.example/openapi.json",
      expect.objectContaining({ method: "GET", body: undefined }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(schema);
  });

  it("forwards credentials to the token endpoint without requiring a session", async () => {
    vi.stubEnv("API_BASE_URL", "https://backend.example");
    const token = { accessToken: "test-token", tokenType: "Bearer", expiresIn: 3600 };
    const fetchBackend = vi.fn().mockResolvedValue(Response.json(token));
    vi.stubGlobal("fetch", fetchBackend);
    const credentials = { email: "user@example.com", password: "test-password" };

    const response = await POST(
      new NextRequest("https://idp.example/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      }),
      { params: Promise.resolve({ path: ["auth", "token"] }) },
    );

    const [url, options] = fetchBackend.mock.calls[0];
    expect(url).toBe("https://backend.example/auth/token");
    expect(options.method).toBe("POST");
    expect(options.headers.get("content-type")).toBe("application/json");
    expect(await new Response(options.body).json()).toEqual(credentials);
    expect(await response.json()).toEqual(token);
  });

  it("preserves upload bodies, bearer authentication, query strings, and backend errors", async () => {
    vi.stubEnv("API_BASE_URL", "https://backend.example");
    const fetchBackend = vi.fn().mockResolvedValue(
      Response.json({ code: "unauthorized" }, { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchBackend);
    const form = new FormData();
    form.append("file", new Blob(["document"], { type: "application/pdf" }), "claim.pdf");
    const request = new NextRequest("https://idp.example/api/processes/process-1/trigger?test=1", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body: form,
    });

    const response = await POST(request, {
      params: Promise.resolve({ path: ["processes", "process-1", "trigger"] }),
    });

    const [url, options] = fetchBackend.mock.calls[0];
    expect(url).toBe("https://backend.example/processes/process-1/trigger?test=1");
    expect(options.headers.get("authorization")).toBe("Bearer test-token");
    expect(options.headers.get("content-type")).toBe(request.headers.get("content-type"));
    expect(options.body).toBe(request.body);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "unauthorized" });
  });
});
