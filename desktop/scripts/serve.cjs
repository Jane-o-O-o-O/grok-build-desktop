const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "renderer");
const port = Number(process.env.PORT || 4174);
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml" };

http.createServer((request, response) => {
  const relative = request.url === "/" ? "index.html" : decodeURIComponent(request.url.split("?")[0]).replace(/^\/+/, "");
  const target = path.resolve(root, relative);
  if (!target.startsWith(root)) { response.writeHead(403).end("Forbidden"); return; }
  fs.readFile(target, (error, data) => {
    if (error) { response.writeHead(404).end("Not found"); return; }
    response.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(data);
  });
}).listen(port, "127.0.0.1", () => console.log(`Grok Desktop preview: http://127.0.0.1:${port}`));
