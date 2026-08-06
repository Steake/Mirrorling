import { gzipSync } from "node:zlib";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

export interface ProductionFixture {
  readonly origin: string;
  listen(): Promise<void>;
  close(): Promise<void>;
}

function page(origin: string, pathname: string): string {
  if (pathname === "/account") {
    return `<!doctype html><html><head><title>Production account</title><link rel="stylesheet" href="${origin}/assets/prod.css"></head>
<body><main><p class="eyebrow">Production origin</p><h1 id="account-title">Production resumed</h1><pre id="handoff-state"></pre></main>
<script>document.querySelector('#handoff-state').textContent = new URL(location.href).searchParams.get('bench_state') || 'No carried client state';</script></body></html>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Production fixture</title>
  <link rel="stylesheet" href="${origin}/assets/prod.css">
</head>
<body>
  <header><a href="${origin}/">Northstar</a><nav><a id="absolute-account-link" href="${origin}/account">Account</a></nav></header>
  <main>
    <p class="eyebrow">Live production fixture</p>
    <h1>Production checkout</h1>
    <img id="production-image" src="${origin}/assets/mark.svg" alt="Northstar mark" width="96" height="96">
    <section id="production-offer"><h2>Original production offer</h2><p>This region belongs to production.</p></section>
    <button id="production-counter" type="button">Production behaviour: <span>0</span></button>
  </main>
  <script src="${origin}/assets/prod.js"></script>
</body>
</html>`;
}

export function createProductionFixture(port = 4311): ProductionFixture {
  let origin = `http://127.0.0.1:${port}`;
  const server: Server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", origin);
    if (requestUrl.pathname === "/assets/prod.css") {
      const body = `:root{color-scheme:dark;font:16px/1.5 system-ui,sans-serif;background:#10141a;color:#f4f7fa}body{margin:0}header{display:flex;justify-content:space-between;padding:20px 5vw;border-bottom:1px solid #2a303a}a{color:#6ee7b7}main{max-width:760px;margin:0 auto;padding:72px 24px}.eyebrow{color:#6ee7b7;text-transform:uppercase;letter-spacing:.12em;font-weight:800}h1{font-size:clamp(2.5rem,8vw,5rem);line-height:.95}section{margin-block:32px;padding:24px;background:#1a2029;border-radius:16px}button{padding:10px 14px}`;
      response.writeHead(200, {
        "content-type": "text/css; charset=utf-8",
        "content-length": String(Buffer.byteLength(body)),
        "cache-control": "public, max-age=300",
      });
      response.end(body);
      return;
    }
    if (requestUrl.pathname === "/assets/prod.js") {
      const body = `document.querySelector('#production-counter')?.addEventListener('click',()=>{const n=document.querySelector('#production-counter span');n.textContent=String(Number(n.textContent)+1)});document.documentElement.dataset.productionScript='ready';`;
      response.writeHead(200, {
        "content-type": "application/javascript; charset=utf-8",
        "content-length": String(Buffer.byteLength(body)),
      });
      response.end(body);
      return;
    }
    if (requestUrl.pathname === "/assets/mark.svg") {
      const body = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="24" fill="#6ee7b7"/><path d="M25 68V28h9l28 27V28h9v40h-9L34 41v27z" fill="#07110e"/></svg>`;
      response.writeHead(200, {
        "content-type": "image/svg+xml",
        "content-length": String(Buffer.byteLength(body)),
        "access-control-allow-origin": "*",
      });
      response.end(body);
      return;
    }
    if (requestUrl.pathname === "/api/recommendation") {
      const body = JSON.stringify({ title: "Production result", detail: "Untouched upstream API." });
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": String(Buffer.byteLength(body)),
      });
      response.end(body);
      return;
    }
    if (requestUrl.pathname === "/api/request-inspection") {
      const body = JSON.stringify({ headers: request.headers });
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": String(Buffer.byteLength(body)),
      });
      response.end(body);
      return;
    }
    if (requestUrl.pathname === "/redirect-me") {
      response.writeHead(302, { location: `${origin}/account` });
      response.end();
      return;
    }

    const body = Buffer.from(page(origin, requestUrl.pathname));
    const compressed = gzipSync(body);
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-encoding": "gzip",
      "content-length": String(compressed.byteLength),
      "content-security-policy": "default-src 'self'",
      "set-cookie": "fixture_session=production-copy; Path=/; HttpOnly; Secure; SameSite=Lax",
    });
    response.end(compressed);
  });

  return {
    get origin() {
      return origin;
    },
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          const address = server.address() as AddressInfo;
          origin = `http://127.0.0.1:${address.port}`;
          console.log(`[fixture] Production listening on ${origin}`);
          resolve();
        });
      });
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function main(): Promise<void> {
  const fixture = createProductionFixture(Number(process.env.FIXTURE_PORT ?? 4311));
  await fixture.listen();
  const close = async () => fixture.close();
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
