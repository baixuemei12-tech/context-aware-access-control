const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const GATEWAY = process.env.CAAC_GATEWAY_URL || 'http://10.216.217.146:5051';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const requested = url.pathname === '/' ? '/overview.html' : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(ROOT, requested));

  if (!filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

function proxyApi(req, res) {
  const target = new URL(req.url, GATEWAY);
  const headers = { ...req.headers, host: target.host };
  delete headers.origin;
  delete headers.referer;

  const proxyReq = http.request(target, { method: req.method, headers }, proxyRes => {
    const outHeaders = { ...proxyRes.headers };
    delete outHeaders['access-control-allow-origin'];
    res.writeHead(proxyRes.statusCode || 502, outHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Gateway proxy failed', detail: err.message }));
  });

  req.pipe(proxyReq);
}

http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }
  serveStatic(req, res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`CAAC website dev server: http://127.0.0.1:${PORT}/overview.html`);
  console.log(`Proxying /api to ${GATEWAY}`);
});
