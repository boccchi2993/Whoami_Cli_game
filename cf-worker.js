// Cloudflare Worker standalone proxy.
// Deploy with: wrangler deploy cf-worker.js --name clwade-proxy

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

const DEFAULT_ALLOWED_HOSTS = [
  'api.anthropic.com',
  'api.deepseek.com',
  'api.openai.com',
];

function getAllowedHosts(env) {
  return String(env.ALLOWED_PROXY_HOSTS || DEFAULT_ALLOWED_HOSTS.join(','))
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function getMaxBodyBytes(env) {
  const configured = Number.parseInt(env.MAX_PROXY_BODY_BYTES || '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 1024 * 1024;
}

function json(status, payload) {
  return Response.json(payload, { status, headers: CORS_HEADERS });
}

function parseTarget(rawTarget, allowedHosts) {
  if (!rawTarget) {
    return { error: json(400, { error: { message: 'Missing X-Target-URL header' } }) };
  }

  let target;
  try {
    target = new URL(rawTarget);
  } catch {
    return { error: json(400, { error: { message: 'Invalid X-Target-URL header' } }) };
  }

  if (target.protocol !== 'https:' || !allowedHosts.includes(target.hostname.toLowerCase())) {
    return { error: json(403, { error: { message: 'Target host is not allowed' } }) };
  }

  return { target };
}

async function readBody(request, maxBodyBytes) {
  const body = await request.text();
  if (new TextEncoder().encode(body).length > maxBodyBytes) {
    return { error: json(413, { error: { message: 'Request body too large' } }) };
  }
  return { body };
}

export default {
  async fetch(request, env = {}) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === 'GET') {
      return new Response('clwade cdoe proxy ok', {
        headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
    }

    const { target, error: targetError } = parseTarget(
      request.headers.get('X-Target-URL'),
      getAllowedHosts(env)
    );
    if (targetError) return targetError;

    const { body, error: bodyError } = await readBody(request, getMaxBodyBytes(env));
    if (bodyError) return bodyError;

    const headers = new Headers({ 'Content-Type': 'application/json' });
    for (const h of ['authorization', 'x-api-key', 'anthropic-version']) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }

    try {
      const upstream = await fetch(target.href, {
        method: 'POST',
        headers,
        body,
      });

      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('content-type') || 'application/json',
          ...CORS_HEADERS,
        },
      });
    } catch (e) {
      return json(502, { error: { message: 'proxy: ' + e.message } });
    }
  },
};
