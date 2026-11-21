import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/index.ts";

const body = Buffer.from("0123456789");
const etag = '"homebrew-test-etag"';
const uploaded = new Date("2025-01-02T03:04:05.000Z");

function createObject(data = body, size = body.length) {
  return {
    body: new Response(data).body,
    httpEtag: etag,
    size,
    uploaded,
  };
}

function createEnvironment({
  missing = false,
  failHead = false,
  failGet = false,
} = {}) {
  const calls = { get: [], head: [] };
  const env = {
    APP_FILES: {
      async head(key) {
        calls.head.push(key);
        if (failHead) throw new Error("R2 unavailable");
        return missing ? null : createObject();
      },
      async get(key, options) {
        calls.get.push({ key, options });
        if (failGet) throw new Error("R2 unavailable");
        if (missing) return null;
        const range = options?.range;
        const data = range
          ? body.subarray(range.offset, range.offset + range.length)
          : body;
        return createObject(data, body.length);
      },
    },
  };

  return { calls, env };
}

function request(path, init = {}) {
  return new Request(`https://homebrew.lbenicio.dev${path}`, init);
}

test("health endpoint supports GET and HEAD without accessing R2", async () => {
  const { calls, env } = createEnvironment();

  const getResponse = await worker.fetch(request("/health"), env);
  assert.equal(getResponse.status, 200);
  assert.deepEqual(await getResponse.json(), { status: "ok" });

  const headResponse = await worker.fetch(
    request("/health", { method: "HEAD" }),
    env,
  );
  assert.equal(headResponse.status, 200);
  assert.equal(headResponse.headers.get("content-type"), "application/json");
  assert.equal(await headResponse.text(), "");
  assert.deepEqual(calls, { get: [], head: [] });
});

test("rejects unsupported methods and unknown paths", async () => {
  const { env } = createEnvironment();

  const methodResponse = await worker.fetch(
    request("/v1/downloads/example/1.0/App.dmg", { method: "POST" }),
    env,
  );
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get("allow"), "GET, HEAD");

  assert.equal((await worker.fetch(request("/not-found"), env)).status, 404);
  assert.equal(
    (await worker.fetch(request("/v1/downloads/example/1.0"), env)).status,
    404,
  );
});

test("rejects query strings and unsafe download path segments", async () => {
  const { calls, env } = createEnvironment();

  assert.equal(
    (
      await worker.fetch(
        request("/v1/downloads/example/1.0/App.dmg?source=web"),
        env,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await worker.fetch(
        request("/v1/downloads/example/1.0/Bad%20Name.dmg"),
        env,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await worker.fetch(
        request("/v1/downloads/example/1.0/%2Fetc%2Fpasswd"),
        env,
      )
    ).status,
    400,
  );
  assert.equal(
    (await worker.fetch(request("/v1/downloads/example/1.0/%E0%A4%A"), env))
      .status,
    400,
  );
  assert.deepEqual(calls, { get: [], head: [] });
});

test("streams a download from the fixed R2 prefix with safe response headers", async () => {
  const { calls, env } = createEnvironment();
  const response = await worker.fetch(
    request(
      "/v1/downloads/quick-look-image-size/3.0/Quick-Look-Image-Size-3.0.dmg",
    ),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), body.toString());
  assert.deepEqual(calls.get, [
    {
      key: "homebrew/applications/quick-look-image-size/3.0/Quick-Look-Image-Size-3.0.dmg",
      options: undefined,
    },
  ]);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="Quick-Look-Image-Size-3.0.dmg"',
  );
  assert.equal(response.headers.get("content-length"), String(body.length));
  assert.equal(
    response.headers.get("content-type"),
    "application/octet-stream",
  );
  assert.equal(response.headers.get("etag"), etag);
  assert.equal(response.headers.get("last-modified"), uploaded.toUTCString());
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("serves HEAD metadata without reading the object body", async () => {
  const { calls, env } = createEnvironment();
  const response = await worker.fetch(
    request("/v1/downloads/example/1.0/App.dmg", { method: "HEAD" }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("content-length"), String(body.length));
  assert.deepEqual(calls.head, ["homebrew/applications/example/1.0/App.dmg"]);
  assert.deepEqual(calls.get, []);
});

test("returns not found when R2 has no matching object", async () => {
  const { env } = createEnvironment({ missing: true });
  assert.equal(
    (await worker.fetch(request("/v1/downloads/example/1.0/missing.dmg"), env))
      .status,
    404,
  );
  assert.equal(
    (
      await worker.fetch(
        request("/v1/downloads/example/1.0/missing.dmg", { method: "HEAD" }),
        env,
      )
    ).status,
    404,
  );
});

test("serves explicit byte ranges and suffix ranges", async () => {
  const { calls, env } = createEnvironment();
  const explicit = await worker.fetch(
    request("/v1/downloads/example/1.0/App.dmg", {
      headers: { Range: "bytes=2-5" },
    }),
    env,
  );
  assert.equal(explicit.status, 206);
  assert.equal(await explicit.text(), "2345");
  assert.equal(explicit.headers.get("content-range"), "bytes 2-5/10");
  assert.deepEqual(calls.get[0].options, { range: { offset: 2, length: 4 } });

  const suffix = await worker.fetch(
    request("/v1/downloads/example/1.0/App.dmg", {
      headers: { Range: "bytes=-3" },
    }),
    env,
  );
  assert.equal(suffix.status, 206);
  assert.equal(await suffix.text(), "789");
  assert.equal(suffix.headers.get("content-range"), "bytes 7-9/10");
  assert.deepEqual(calls.get[1].options, { range: { offset: 7, length: 3 } });
});

test("ignores unsupported ranges and returns 416 for unsatisfiable ranges", async () => {
  const { env } = createEnvironment();
  const unsupported = await worker.fetch(
    request("/v1/downloads/example/1.0/App.dmg", {
      headers: { Range: "bytes=invalid" },
    }),
    env,
  );
  assert.equal(unsupported.status, 200);
  assert.equal(await unsupported.text(), body.toString());

  const unsatisfiable = await worker.fetch(
    request("/v1/downloads/example/1.0/App.dmg", {
      headers: { Range: "bytes=10-" },
    }),
    env,
  );
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers.get("content-range"), "bytes */10");
});

test("ignores a range when If-Range does not match", async () => {
  const { calls, env } = createEnvironment();
  const response = await worker.fetch(
    request("/v1/downloads/example/1.0/App.dmg", {
      headers: { Range: "bytes=0-1", "If-Range": '"older-etag"' },
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), body.toString());
  assert.equal(calls.get[0].options, undefined);
});

test("uses HTTP dates in If-Range to decide whether to serve a range", async () => {
  const { env } = createEnvironment();
  const current = await worker.fetch(
    request("/v1/downloads/example/1.0/App.dmg", {
      headers: {
        Range: "bytes=0-1",
        "If-Range": new Date(uploaded.getTime() + 1000).toUTCString(),
      },
    }),
    env,
  );
  assert.equal(current.status, 206);
  assert.equal(await current.text(), "01");

  const stale = await worker.fetch(
    request("/v1/downloads/example/1.0/App.dmg", {
      headers: {
        Range: "bytes=0-1",
        "If-Range": new Date(uploaded.getTime() - 1000).toUTCString(),
      },
    }),
    env,
  );
  assert.equal(stale.status, 200);
  assert.equal(await stale.text(), body.toString());
});

test("returns 304 when entity tags or modification dates match", async () => {
  const { env } = createEnvironment();
  const etagResponse = await worker.fetch(
    request("/v1/downloads/example/1.0/App.dmg", {
      headers: { "If-None-Match": `W/${etag}` },
    }),
    env,
  );
  assert.equal(etagResponse.status, 304);
  assert.equal(etagResponse.headers.get("etag"), etag);
  assert.equal(etagResponse.headers.has("content-length"), false);
  assert.equal(etagResponse.headers.has("content-disposition"), false);

  const dateResponse = await worker.fetch(
    request("/v1/downloads/example/1.0/App.dmg", {
      headers: {
        "If-Modified-Since": new Date(uploaded.getTime() + 1000).toUTCString(),
      },
    }),
    env,
  );
  assert.equal(dateResponse.status, 304);
});

test("returns 412 when If-Match or If-Unmodified-Since preconditions fail", async () => {
  const { env } = createEnvironment();
  const mismatch = await worker.fetch(
    request("/v1/downloads/example/1.0/App.dmg", {
      headers: { "If-Match": '"different"' },
    }),
    env,
  );
  assert.equal(mismatch.status, 412);

  const stale = await worker.fetch(
    request("/v1/downloads/example/1.0/App.dmg", {
      method: "HEAD",
      headers: {
        "If-Unmodified-Since": new Date(
          uploaded.getTime() - 1000,
        ).toUTCString(),
      },
    }),
    env,
  );
  assert.equal(stale.status, 412);
});

test("returns 503 when R2 access fails", async () => {
  const failedGet = createEnvironment({ failGet: true });
  assert.equal(
    (
      await worker.fetch(
        request("/v1/downloads/example/1.0/App.dmg"),
        failedGet.env,
      )
    ).status,
    503,
  );

  const failedHead = createEnvironment({ failHead: true });
  assert.equal(
    (
      await worker.fetch(
        request("/v1/downloads/example/1.0/App.dmg", { method: "HEAD" }),
        failedHead.env,
      )
    ).status,
    503,
  );
});
