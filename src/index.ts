interface Env {
  APP_FILES: R2Bucket;
}

interface ByteRange {
  start: number;
  end: number;
  length: number;
}

const DOWNLOAD_PREFIX = "homebrew/applications";
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

function decodeSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    if (!SAFE_SEGMENT.test(decoded) || decoded.includes("..")) return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (size === 0) return "unsatisfiable";

  let start: number;
  let end: number;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    if (!Number.isSafeInteger(start) || start >= size) return "unsatisfiable";

    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(end) || end < start) return "unsatisfiable";
    end = Math.min(end, size - 1);
  }

  return { start, end, length: end - start + 1 };
}

function etagMatches(header: string, etag: string, weak: boolean): boolean {
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    if (value === "*") return true;
    return (weak ? value.replace(/^W\//, "") : value) === etag;
  });
}

function preconditionStatus(request: Request, object: R2Object): 304 | 412 | null {
  const headers = request.headers;
  const ifMatch = headers.get("if-match");
  if (ifMatch && !etagMatches(ifMatch, object.httpEtag, false)) return 412;

  if (!ifMatch) {
    const ifUnmodifiedSince = headers.get("if-unmodified-since");
    if (ifUnmodifiedSince) {
      const date = Date.parse(ifUnmodifiedSince);
      if (Number.isFinite(date) && object.uploaded.getTime() > date) return 412;
    }
  }

  const ifNoneMatch = headers.get("if-none-match");
  if (ifNoneMatch) {
    return etagMatches(ifNoneMatch, object.httpEtag, true) ? 304 : null;
  }

  const ifModifiedSince = headers.get("if-modified-since");
  if (ifModifiedSince) {
    const date = Date.parse(ifModifiedSince);
    if (Number.isFinite(date) && object.uploaded.getTime() <= date) return 304;
  }

  return null;
}

function ifRangeMatches(value: string | null, object: R2Object): boolean {
  if (!value) return true;
  if (value.startsWith('"') || value.startsWith("W/")) {
    return value === object.httpEtag;
  }

  const date = Date.parse(value);
  return Number.isFinite(date) && object.uploaded.getTime() <= date;
}

function downloadHeaders(object: R2Object, filename: string, length: number): Headers {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": CACHE_CONTROL,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(length),
    "Content-Type": "application/octet-stream",
    ETag: object.httpEtag,
    "Last-Modified": object.uploaded.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  });
  return headers;
}

function conditionalResponse(status: 304 | 412, headers: Headers): Response {
  headers.delete("Content-Length");
  headers.delete("Content-Disposition");
  return new Response(null, { status, headers });
}

async function download(request: Request, env: Env, pathname: string): Promise<Response> {
  const parts = pathname.split("/");
  if (parts.length !== 6 || parts[1] !== "v1" || parts[2] !== "downloads") {
    return new Response("Not found", { status: 404 });
  }

  const app = decodeSegment(parts[3]);
  const version = decodeSegment(parts[4]);
  const filename = decodeSegment(parts[5]);
  if (!app || !version || !filename) return new Response("Invalid download path", { status: 400 });

  const key = `${DOWNLOAD_PREFIX}/${app}/${version}/${filename}`;
  const method = request.method;
  const requestedRange = method === "GET" ? request.headers.get("range") : null;

  let metadata: R2Object | null = null;
  let range: ByteRange | null = null;
  if (method === "HEAD" || requestedRange) {
    metadata = await env.APP_FILES.head(key);
    if (!metadata) return new Response("Not found", { status: 404 });

    const conditionalStatus = preconditionStatus(request, metadata);
    const baseHeaders = downloadHeaders(metadata, filename, metadata.size);
    if (conditionalStatus) return conditionalResponse(conditionalStatus, baseHeaders);

    if (method === "HEAD") return new Response(null, { status: 200, headers: baseHeaders });

    if (ifRangeMatches(request.headers.get("if-range"), metadata)) {
      const parsed = parseRange(requestedRange, metadata.size);
      if (parsed === "unsatisfiable") {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${metadata.size}` },
        });
      }
      range = parsed;
    }
  }

  const object = await env.APP_FILES.get(
    key,
    range ? { range: { offset: range.start, length: range.length } } : undefined,
  );
  if (!object) return new Response("Not found", { status: 404 });

  const conditionalStatus = preconditionStatus(request, object);
  const headers = downloadHeaders(object, filename, range?.length ?? object.size);
  if (conditionalStatus) return conditionalResponse(conditionalStatus, headers);

  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${object.size}`);
  }

  return new Response(object.body, { status: range ? 206 : 200, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && (request.method === "GET" || request.method === "HEAD")) {
      return request.method === "HEAD"
        ? new Response(null, { status: 200, headers: { "Content-Type": "application/json" } })
        : Response.json({ status: "ok" }, { status: 200 });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    if (url.search) return new Response("Query parameters are not supported", { status: 400 });
    if (!url.pathname.startsWith("/v1/downloads/")) return new Response("Not found", { status: 404 });

    try {
      return await download(request, env, url.pathname);
    } catch {
      return new Response("Download temporarily unavailable", { status: 503 });
    }
  },
};
