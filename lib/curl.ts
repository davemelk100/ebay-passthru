import "server-only";
import { execFile } from "node:child_process";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

// eBay's edge rejects Node's TLS fingerprint when Trading API headers are present,
// so we shell out to the system `curl` binary instead of using fetch. Sell REST
// works fine over fetch, but uses the same path for consistency.
export function curlRequest(
  url: string,
  method: HttpMethod,
  headers: Record<string, string>,
  body: string | null,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const STATUS_MARKER = "\n__EBAY_HTTP_STATUS__:";
    const args = ["-sS", "-X", method, "-w", `${STATUS_MARKER}%{http_code}`];
    for (const [k, v] of Object.entries(headers)) {
      args.push("-H", `${k}: ${v}`);
    }
    if (body !== null) args.push("--data-binary", "@-");
    args.push(url);

    const child = execFile(
      "curl",
      args,
      { maxBuffer: 50 * 1024 * 1024, timeout: 60_000 },
      (err, stdout) => {
        if (err) return reject(err);
        const idx = stdout.lastIndexOf(STATUS_MARKER);
        if (idx < 0) return resolve({ status: 0, text: stdout });
        const status = Number.parseInt(stdout.slice(idx + STATUS_MARKER.length).trim(), 10);
        resolve({ status: Number.isFinite(status) ? status : 0, text: stdout.slice(0, idx) });
      },
    );
    if (child.stdin) {
      if (body !== null) child.stdin.end(body);
      else child.stdin.end();
    }
  });
}
