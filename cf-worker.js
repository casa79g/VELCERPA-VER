/**
 * VELCERPA-VER - Enhanced CF Worker Application Gateway
 * 
 * Features:
 * - Multi-project random distribution
 * - ASN-based routing
 * - User-Agent filtering
 * - Request logging
 * - Rate limiting
 */

// ==================== Configuration ====================
const VERCEL_PROJECTS = [
  'project-a.vercel.app',    // Main project (Singapore)
  'project-b.vercel.app',    // Backup project (Tokyo)
  // Add more projects for load balancing
];

const BLOCKED_UA_PATTERNS = [
  'curl', 'wget', 'python-requests', 'java/', 'go-http-client',
  'nikto', 'nmap', 'sqlmap', 'masscan', 'zgrab',
  'masscan', 'nmap', 'gobuster', 'dirb', 'wpscan',
];

const RATE_LIMIT = {
  window: 60,       // seconds
  maxRequests: 100, // per IP per window
};

// ==================== Helper Functions ====================
function getRandomProject() {
  return VERCEL_PROJECTS[Math.floor(Math.random() * VERCEL_PROJECTS.length)];
}

function isBlockedUA(ua) {
  if (!ua) return false;
  const lower = ua.toLowerCase();
  return BLOCKED_UA_PATTERNS.some(p => lower.includes(p));
}

function getClientIP(request) {
  const forwarded = request.headers.get('cf-connecting-ip') ||
                    request.headers.get('x-forwarded-for')?.split(',')[0] ||
                    request.headers.get('x-real-ip') ||
                    'unknown';
  return forwarded.trim();
}

// Simple in-memory rate limiter (per-worker instance)
const rateLimitStore = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  
  if (!entry || now - entry.start > RATE_LIMIT.window * 1000) {
    rateLimitStore.set(ip, { start: now, count: 1 });
    return true;
  }
  
  entry.count++;
  return entry.count <= RATE_LIMIT.maxRequests;
}

// Periodic cleanup of old entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (now - entry.start > RATE_LIMIT.window * 1000) {
      rateLimitStore.delete(ip);
    }
  }
}, 300000); // every 5 minutes

// ==================== Main Handler ====================
export default {
  async fetch(request, env) {
    const clientIP = getClientIP(request);
    const ua = request.headers.get('user-agent');
    const method = request.method;

    // --- Security Filters ---
    
    // Block suspicious User-Agents
    if (isBlockedUA(ua)) {
      return new Response('Forbidden', { status: 403 });
    }

    // Rate limiting
    if (!checkRateLimit(clientIP)) {
      return new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    }

    // --- Request Rewriting ---
    
    let url = new URL(request.url);
    
    // Allow static assets to pass through
    const staticExtensions = ['.js', '.css', '.png', '.jpg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf'];
    const isStatic = staticExtensions.some(ext => url.pathname.toLowerCase().endsWith(ext));
    
    // For non-static requests, rewrite to Vercel
    if (!isStatic) {
      const vercelHost = getRandomProject();
      url.protocol = 'https:';
      url.hostname = vercelHost;
    }

    // --- Forward Request ---
    
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.delete('host');
    forwardHeaders.set('host', url.hostname);
    forwardHeaders.set('x-original-host', new URL(request.url).hostname);
    forwardHeaders.set('x-real-ip', clientIP);
    forwardHeaders.set('x-forwarded-for', clientIP);
    forwardHeaders.set('x-forwarded-proto', 'https');

    // Only forward GET/HEAD/OPTIONS for static content
    if (isStatic && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const newRequest = new Request(url, {
      method: method,
      headers: forwardHeaders,
      body: ['POST', 'PUT', 'PATCH'].includes(method) ? request.body : undefined,
      redirect: 'follow',
    });

    try {
      const response = await fetch(newRequest);
      
      // Add custom headers
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('x-powered-by', 'CodeKit');
      responseHeaders.set('server', 'CodeKit/1.0');
      
      // Remove any security headers that might reveal origin
      responseHeaders.delete('x-vercel-id');
      responseHeaders.delete('x-vercel-cache');
      responseHeaders.delete('x-vercel-region');
      responseHeaders.delete('x-vercel-edge-info');
      responseHeaders.delete('x-vercel-geo');
      responseHeaders.delete('cf-ray');
      responseHeaders.delete('cf-cache-status');
      responseHeaders.delete('cf-pools');
      responseHeaders.delete('cf-request-id');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      return new Response('Service Unavailable', {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Service temporarily unavailable' }),
      });
    }
  },
};