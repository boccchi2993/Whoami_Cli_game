#!/usr/bin/env node
// Clwade Cdoe — 本地代理服务器
// 用法: node server.js [端口]
// 然后浏览器打开 http://localhost:3000

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = parseInt(process.argv[2]) || 3000;
const HTML = path.join(__dirname, 'index.html');
const MAX_BODY_BYTES = parseInt(process.env.MAX_PROXY_BODY_BYTES || '', 10) || 1024 * 1024;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400'
};

function isAllowedTarget(url) {
  return url.protocol === 'https:';
}

function json(res, status, payload) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {

  // ── CORS preflight ──
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  // ── Serve index.html ──
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    if (!fs.existsSync(HTML)) {
      res.writeHead(404);
      return res.end('index.html not found — put it next to server.js');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(HTML).pipe(res);
  }

  // ── API proxy: POST /proxy ──
  if (req.method === 'POST' && req.url === '/proxy') {
    const target = req.headers['x-target-url'];
    if (!target) {
      return json(res, 400, { error: { message: 'Missing X-Target-URL header' } });
    }

    let body = '';
    let bodyBytes = 0;
    let rejected = false;
    req.on('data', c => {
      bodyBytes += c.length;
      if (bodyBytes > MAX_BODY_BYTES) {
        rejected = true;
        json(res, 413, { error: { message: 'Request body too large' } });
        req.destroy();
        return;
      }
      body += c;
    });
    req.on('end', () => {
      if (rejected) return;
      let url;
      try { url = new URL(target); } catch (e) {
        return json(res, 400, { error: { message: 'Invalid URL: ' + target } });
      }
      if (!isAllowedTarget(url)) {
        return json(res, 403, { error: { message: 'Target URL must use HTTPS' } });
      }

      const fwd = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      };

      // Forward auth headers
      ['authorization', 'x-api-key', 'anthropic-version'].forEach(h => {
        if (req.headers[h]) fwd.headers[h] = req.headers[h];
      });

      const transport = url.protocol === 'https:' ? https : http;
      const proxy = transport.request(fwd, upstream => {
        const chunks = [];
        upstream.on('data', c => chunks.push(c));
        upstream.on('end', () => {
          res.writeHead(upstream.statusCode, {
            ...CORS,
            'Content-Type': upstream.headers['content-type'] || 'application/json'
          });
          res.end(Buffer.concat(chunks));
        });
      });

      proxy.on('error', e => {
        res.writeHead(502, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'proxy error: ' + e.message } }));
      });

      proxy.write(body);
      proxy.end();
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Clwade Cdoe v0.0.7-nightmare');
  console.log('  ─────────────────────────────');
  console.log('  http://localhost:' + PORT);
  console.log('');
  console.log('  把 index.html 和 server.js 放同一目录');
  console.log('  Ctrl+C 退出');
  console.log('');
});
