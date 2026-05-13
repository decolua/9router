/**
 * 9Router Tunnel Registration Worker
 * 
 * This worker handles tunnel registration from 9router instances.
 * It stores the mapping between shortId and tunnelUrl in Cloudflare KV.
 * 
 * Usage:
 * - POST /api/tunnel/register with { shortId, tunnelUrl }
 * - GET /api/tunnel/:shortId to retrieve tunnel URL
 * - GET /api/tunnel/:shortId/redirect to redirect to tunnel URL
 * 
 * Environment variables:
 * - TUNNEL_KV: KV namespace binding (must be configured in wrangler.toml)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname;
    const hostname = url.hostname;

    // CORS headers for browser access
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Extract shortId from hostname if pattern matches r{shortId}.domain
      // e.g., rabc123.yourdomain.com → abc123
      let shortIdFromHost = null;
      const publicDomain = env.PUBLIC_DOMAIN || "9router.com";
      if (hostname.endsWith(publicDomain)) {
        const prefix = hostname.replace(`.${publicDomain}`, '');
        const match = prefix.match(/^r([a-zA-Z0-9]{6})$/);
        if (match) {
          shortIdFromHost = match[1].toLowerCase();
        }
      }

      // POST /api/tunnel/register - Register a tunnel
      if (path === '/api/tunnel/register' && request.method === 'POST') {
        const { shortId, tunnelUrl } = await request.json();

        if (!shortId || !tunnelUrl) {
          return jsonResponse.error(400, 'Missing required fields: shortId and tunnelUrl', corsHeaders);
        }

        if (!/^[a-zA-Z0-9]{6}$/.test(shortId)) {
          return jsonResponse.error(400, 'Invalid shortId format. Must be 6 alphanumeric characters.', corsHeaders);
        }

        try {
          new URL(tunnelUrl);
        } catch {
          return jsonResponse.error(400, 'Invalid tunnelUrl. Must be a valid URL.', corsHeaders);
        }

        const key = `tunnel:${shortId}`;
        const value = JSON.stringify({
          tunnelUrl,
          registeredAt: Date.now(),
          expiresAt: Date.now() + (24 * 60 * 60 * 1000),
        });

        await env.TUNNEL_KV.put(key, value, {
          expirationTtl: 24 * 60 * 60,
        });

        console.log(`[Tunnel] Registered shortId=${shortId} tunnelUrl=${tunnelUrl}`);

        return jsonResponse.success({ 
          success: true, 
          shortId, 
          tunnelUrl,
          message: 'Tunnel registered successfully'
        }, corsHeaders);
      }

      // GET /api/tunnel/:shortId - Get tunnel info
      const getMatch = path.match(/^\/api\/tunnel\/([a-z0-9]{6})$/i);
      if (getMatch && request.method === 'GET') {
        const shortId = getMatch[1].toLowerCase();
        const key = `tunnel:${shortId}`;

        const data = await env.TUNNEL_KV.get(key, 'json');

        if (!data) {
          return jsonResponse.error(404, 'Tunnel not found or expired', corsHeaders);
        }

        if (Date.now() > data.expiresAt) {
          await env.TUNNEL_KV.delete(key);
          return jsonResponse.error(410, 'Tunnel expired', corsHeaders);
        }

        return jsonResponse.success({ 
          shortId, 
          tunnelUrl: data.tunnelUrl,
          registeredAt: data.registeredAt,
          expiresAt: data.expiresAt
        }, corsHeaders);
      }

      // GET /api/tunnel/:shortId/redirect - Redirect to tunnel URL
      const redirectMatch = path.match(/^\/api\/tunnel\/([a-z0-9]{6})\/redirect$/i);
      if (redirectMatch && request.method === 'GET') {
        const shortId = redirectMatch[1].toLowerCase();
        const key = `tunnel:${shortId}`;

        const data = await env.TUNNEL_KV.get(key, 'json');

        if (!data) {
          return new Response('Tunnel not found or expired', { 
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
          });
        }

        if (Date.now() > data.expiresAt) {
          await env.TUNNEL_KV.delete(key);
          return new Response('Tunnel expired', { 
            status: 410,
            headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
          });
        }

        return Response.redirect(data.tunnelUrl, 302);
      }

      // GET /api/tunnel/list - List all active tunnels
      if (path === '/api/tunnel/list' && request.method === 'GET') {
        const prefix = 'tunnel:';
        const listed = await env.TUNNEL_KV.list({ prefix });

        const tunnels = [];
        for (const key of listed.keys) {
          const data = await env.TUNNEL_KV.get(key.name, 'json');
          if (data && Date.now() < data.expiresAt) {
            tunnels.push({
              shortId: key.name.replace(prefix, ''),
              tunnelUrl: data.tunnelUrl,
              expiresAt: data.expiresAt
            });
          }
        }

        return jsonResponse.success({ tunnels, count: tunnels.length }, corsHeaders);
      }

      // Health check (for publicUrl probe)
      if (path === '/api/health' && request.method === 'GET') {
        // If accessed via r{shortId}.domain, check tunnel health
        if (shortIdFromHost) {
          const key = `tunnel:${shortIdFromHost}`;
          const data = await env.TUNNEL_KV.get(key, 'json');
          
          if (!data) {
            return jsonResponse.error(404, 'Tunnel not found', corsHeaders);
          }

          if (Date.now() > data.expiresAt) {
            await env.TUNNEL_KV.delete(key);
            return jsonResponse.error(410, 'Tunnel expired', corsHeaders);
          }

          // Probe tunnel URL health
          try {
            const healthUrl = data.tunnelUrl.replace(/\/+$/, '') + '/api/health';
            const healthRes = await fetch(healthUrl, { method: 'GET' });
            if (healthRes.ok) {
              return jsonResponse.success({ 
                status: 'ok',
                service: '9router tunnel (shortId=' + shortIdFromHost + ')',
                timestamp: Date.now(),
                tunnelReachable: true
              }, corsHeaders);
            }
          } catch (e) {
            console.warn(`[Health] tunnel ${shortIdFromHost} unreachable: ${e.message}`);
          }

          return jsonResponse.success({ 
            status: 'ok',
            service: '9router tunnel wrapper',
            timestamp: Date.now(),
            tunnelReachable: false
          }, corsHeaders);
        }

        return jsonResponse.success({ 
          status: 'ok',
          service: '9router tunnel registration worker',
          timestamp: Date.now()
        }, corsHeaders);
      }

      // Proxy mode: if accessed via r{shortId}.domain/*, forward to tunnel
      if (shortIdFromHost) {
        const key = `tunnel:${shortIdFromHost}`;
        const data = await env.TUNNEL_KV.get(key, 'json');

        if (!data) {
          return jsonResponse.error(404, `Tunnel ${shortIdFromHost} not found`, corsHeaders);
        }

        if (Date.now() > data.expiresAt) {
          await env.TUNNEL_KV.delete(key);
          return jsonResponse.error(410, 'Tunnel expired', corsHeaders);
        }

        // Forward request to tunnel URL, preserving method/headers/body
        const tunnelUrl = new URL(data.tunnelUrl);
        const forwardedUrl = `${data.tunnelUrl}${path}${url.search}`;
        
        try {
          const forwardReq = new Request(forwardedUrl, {
            method: request.method,
            headers: Object.fromEntries([...request.headers].filter(([k]) => k.toLowerCase() !== 'host')),
            body: request.body,
          });

          const forwardRes = await fetch(forwardReq);
          
          const responseHeaders = new Headers(forwardRes.headers);
          Object.entries(corsHeaders).forEach(([k, v]) => responseHeaders.set(k, v));

          return new Response(forwardRes.body, {
            status: forwardRes.status,
            statusText: forwardRes.statusText,
            headers: responseHeaders
          });
        } catch (e) {
          console.error(`[Proxy] ${shortIdFromHost} error: ${e.message}`);
          return jsonResponse.error(502, `Proxy error: ${e.message}`, corsHeaders);
        }
      }

      // 404 for unknown routes
      return jsonResponse.error(404, 'Not found', corsHeaders);

    } catch (error) {
      console.error('[Worker] Error:', error);
      return jsonResponse.error(500, `Internal server error: ${error.message}`, corsHeaders);
    }
  }
};

// Helper JSON response object
const jsonResponse = {
  success: (data, headers = {}) => new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' }
  }),
  
  error: (status, message, headers = {}) => new Response(JSON.stringify({ 
    error: true, 
    status, 
    message 
  }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  })
};