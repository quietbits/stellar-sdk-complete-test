/**
 * Loopback HTTP server for fixture-based tests.
 *
 * Unlike request interception (nock), this is a *real* server on 127.0.0.1: it
 * uses a real socket and exercises each runtime's actual HTTP client, so it
 * works identically on Node, Deno, and Bun and does not hide runtime-specific
 * networking behavior. It exists only to serve deterministic fixtures (error
 * paths, malformed payloads, exact values) that a live endpoint cannot
 * reproduce — genuinely live behavior is covered separately in the live suite.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";

export interface MockRequest {
  method: string;
  pathname: string;
  query: URLSearchParams;
  body: string;
  json(): unknown;
}

export interface MockResponse {
  status?: number;
  json?: unknown;
  text?: string;
}

/** Handler receives the parsed request and the server's own base URL. */
export type Handler = (
  req: MockRequest,
  baseUrl: string,
) => MockResponse | Promise<MockResponse>;

export interface LoopbackServer {
  url: string;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function startServer(handler: Handler): Promise<LoopbackServer> {
  let baseUrl = "";

  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        const body = await readBody(req);
        const parsed = new URL(req.url ?? "/", baseUrl);
        const mockReq: MockRequest = {
          method: req.method ?? "GET",
          pathname: parsed.pathname,
          query: parsed.searchParams,
          body,
          json: () => (body ? JSON.parse(body) : undefined),
        };

        const result = await handler(mockReq, baseUrl);
        const status = result.status ?? 200;

        if (result.text !== undefined) {
          res.writeHead(status, { "content-type": "text/plain" });
          res.end(result.text);
          return;
        }
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.json ?? {}));
      } catch (error) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(error instanceof Error ? error.message : "handler error");
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("loopback server failed to bind a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    url: baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
