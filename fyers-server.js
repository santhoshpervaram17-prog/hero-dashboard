// ===========================
// Fyers API - Local OAuth Server
// ===========================
// Usage: node fyers-server.js
// Then open: http://127.0.0.1:8080
//
// Before running:
// 1. Go to https://myapi.fyers.in → Create/Edit your app
// 2. Set Redirect URL to: http://127.0.0.1:8080/callback
// 3. Copy your App ID and Secret Key below

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ===========================
// ⚠️ FILL IN YOUR FYERS API DETAILS HERE
// ===========================
const CONFIG = {
    APP_ID: process.env.FYERS_APP_ID || 'JPPA3GEAQY-100',       // e.g., 'XXXXXXXXXX-100' — Your Fyers App ID
    SECRET_KEY: process.env.FYERS_SECRET_KEY || 'EZRH2DU5MK',   // Your Fyers Secret Key
    REDIRECT_URI: process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/callback` : (process.env.REDIRECT_URI || 'http://127.0.0.1:8080/callback'),
    PORT: process.env.PORT || 8080
};

// State
const TOKEN_FILE = path.join(__dirname, '.fyers_token.json');
let ACCESS_TOKEN = null;
try {
    if (fs.existsSync(TOKEN_FILE)) {
        const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        if (saved.token && (Date.now() - saved.time < 24 * 60 * 60 * 1000)) {
            ACCESS_TOKEN = saved.token;
            console.log('🔄 Restored saved Fyers access token from disk.');
        }
    }
} catch (e) {
    console.error('Failed to load saved token:', e.message);
}

// ===========================
// HTTP Server
// ===========================
const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1:8080'}`);
    const pathname = reqUrl.pathname;
    const query = Object.fromEntries(reqUrl.searchParams.entries());

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Routes
    if (pathname === '/' || pathname === '/index.html') {
        serveFile(res, 'index.html', 'text/html');
    } else if (pathname === '/live.html') {
        serveFile(res, 'live.html', 'text/html');
    } else if (pathname.endsWith('.css')) {
        serveFile(res, pathname.slice(1), 'text/css');
    } else if (pathname.endsWith('.js') && !pathname.startsWith('/api/')) {
        serveFile(res, pathname.slice(1), 'application/javascript');
    } else if (pathname === '/api/login') {
        handleLogin(req, res);
    } else if (pathname === '/callback') {
        handleCallback(req, res, query);
    } else if (pathname === '/api/token-status') {
        handleTokenStatus(req, res);
    } else if (pathname === '/api/quotes') {
        handleQuotes(req, res, query);
    } else if (pathname === '/api/optionchain') {
        handleOptionChain(req, res, query);
    } else if (pathname === '/api/history') {
        handleHistory(req, res, query);
    } else if (pathname === '/api/marketdata') {
        handleMarketData(req, res, query);
    } else if (pathname === '/api/profile') {
        handleProfile(req, res);
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

// ===========================
// File Server
// ===========================
function serveFile(res, filename, contentType) {
    const filepath = path.join(__dirname, filename);
    fs.readFile(filepath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found: ' + filename);
            return;
        }
        // Prevent browser from caching JS/CSS so updates load immediately
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        res.end(data);
    });
}

// ===========================
// OAuth: Step 1 — Login URL
// ===========================
function handleLogin(req, res) {
    if (!CONFIG.APP_ID || !CONFIG.SECRET_KEY) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: 'API credentials not configured',
            message: 'Open fyers-server.js and fill in APP_ID and SECRET_KEY'
        }));
        return;
    }

    const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${CONFIG.APP_ID}&redirect_uri=${encodeURIComponent(CONFIG.REDIRECT_URI)}&response_type=code&state=hero_strike_live`;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ authUrl }));
}

// ===========================
// OAuth: Step 2 — Callback (receives auth_code)
// ===========================
function handleCallback(req, res, query) {
    const authCode = query.auth_code || query.code;
    const state = query.state;

    if (!authCode) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
            <html><body style="background:#0a0b0f;color:#ff5252;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;">
                <h1>❌ Authentication Failed</h1>
                <p>No auth_code received. Please try logging in again.</p>
                <p style="color:#555;font-size:12px;">Query: ${JSON.stringify(query)}</p>
                <a href="/" style="color:#448aff;margin-top:20px;">← Go Back</a>
            </body></html>
        `);
        return;
    }

    console.log('✅ Received auth_code:', authCode.substring(0, 20) + '...');

    // Exchange auth_code for access_token
    const appIdHash = generateAppIdHash();
    const postData = JSON.stringify({
        grant_type: 'authorization_code',
        appIdHash: appIdHash,
        code: authCode
    });

    const options = {
        hostname: 'api-t1.fyers.in',
        path: '/api/v3/validate-authcode',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const apiReq = https.request(options, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
            try {
                const result = JSON.parse(data);
                console.log('Token response:', result.s === 'ok' ? 'SUCCESS' : 'FAILED');

                if (result.s === 'ok' && result.access_token) {
                    ACCESS_TOKEN = result.access_token;
                    try {
                        fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: ACCESS_TOKEN, time: Date.now() }), 'utf8');
                    } catch (e) { console.error('Failed to save token to disk:', e.message); }
                    console.log('🔑 Access token obtained and saved successfully!');

                    // Redirect to live dashboard
                    res.writeHead(302, { Location: '/live.html?connected=true' });
                    res.end();
                } else {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(`
                        <html><body style="background:#0a0b0f;color:#ff5252;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;">
                            <h1>⚠️ Token Generation Failed</h1>
                            <p>${result.message || 'Unknown error'}</p>
                            <pre style="color:#555;font-size:11px;max-width:500px;overflow:auto;">${JSON.stringify(result, null, 2)}</pre>
                            <a href="/" style="color:#448aff;margin-top:20px;">← Try Again</a>
                        </body></html>
                    `);
                }
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'text/html' });
                res.end(`<html><body style="background:#0a0b0f;color:#ff5252;font-family:Inter,sans-serif;text-align:center;padding:40px;"><h1>Parse Error</h1><p>${e.message}</p></body></html>`);
            }
        });
    });

    apiReq.on('error', (e) => {
        console.error('API Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<html><body style="background:#0a0b0f;color:#ff5252;font-family:Inter,sans-serif;text-align:center;padding:40px;"><h1>Connection Error</h1><p>${e.message}</p></body></html>`);
    });

    apiReq.write(postData);
    apiReq.end();
}

// ===========================
// Generate App ID Hash (SHA-256)
// ===========================
function generateAppIdHash() {
    const hashInput = `${CONFIG.APP_ID}:${CONFIG.SECRET_KEY}`;
    return crypto.createHash('sha256').update(hashInput).digest('hex');
}

// ===========================
// API: Token Status
// ===========================
function handleTokenStatus(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        connected: !!ACCESS_TOKEN,
        appId: CONFIG.APP_ID ? CONFIG.APP_ID.substring(0, 6) + '...' : null,
        configured: !!(CONFIG.APP_ID && CONFIG.SECRET_KEY)
    }));
}

// ===========================
// API: Get Quotes
// ===========================
function handleQuotes(req, res, query) {
    if (!ACCESS_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authenticated. Login first.' }));
        return;
    }

    const symbols = query.symbols || 'NSE:NIFTY50-INDEX';

    const options = {
        hostname: 'api-t1.fyers.in',
        path: `/data/quotes?symbols=${encodeURIComponent(symbols)}`,
        method: 'GET',
        headers: {
            'Authorization': `${CONFIG.APP_ID}:${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };

    proxyRequest(options, res);
}

// ===========================
// API: Option Chain
// ===========================
function handleOptionChain(req, res, query) {
    if (!ACCESS_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authenticated' }));
        return;
    }

    const symbol = query.symbol || 'NSE:NIFTY50-INDEX';
    const strikecount = query.strikecount || '10';
    const timestamp = query.timestamp || '';

    let apiPath = `/data/options-chain-v3?symbol=${encodeURIComponent(symbol)}&strikecount=${strikecount}`;
    if (timestamp) apiPath += `&timestamp=${timestamp}`;

    const options = {
        hostname: 'api-t1.fyers.in',
        path: apiPath,
        method: 'GET',
        headers: {
            'Authorization': `${CONFIG.APP_ID}:${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };

    proxyRequest(options, res);
}

// ===========================
// API: History (Candles)
// ===========================
function handleHistory(req, res, query) {
    if (!ACCESS_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authenticated' }));
        return;
    }

    const symbol = query.symbol || 'NSE:NIFTY50-INDEX';
    const resolution = query.resolution || '1';
    const date_format = query.date_format || '1';
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const range_from = query.range_from || fiveDaysAgo;
    const range_to = query.range_to || todayStr;

    const apiPath = `/data/history?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&date_format=${date_format}&range_from=${range_from}&range_to=${range_to}`;

    const options = {
        hostname: 'api-t1.fyers.in',
        path: apiPath,
        method: 'GET',
        headers: {
            'Authorization': `${CONFIG.APP_ID}:${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };

    proxyRequest(options, res);
}

// ===========================
// API: Market Data (depth)
// ===========================
function handleMarketData(req, res, query) {
    if (!ACCESS_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authenticated' }));
        return;
    }

    const symbol = query.symbol || 'NSE:NIFTY50-INDEX';

    const postData = JSON.stringify({
        symbol: symbol,
        ohlcv_flag: '1'
    });

    const options = {
        hostname: 'api-t1.fyers.in',
        path: '/data/depth',
        method: 'POST',
        headers: {
            'Authorization': `${CONFIG.APP_ID}:${ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    proxyRequest(options, res, postData);
}

// ===========================
// API: Profile
// ===========================
function handleProfile(req, res) {
    if (!ACCESS_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authenticated' }));
        return;
    }

    const options = {
        hostname: 'api-t1.fyers.in',
        path: '/api/v3/profile',
        method: 'GET',
        headers: {
            'Authorization': `${CONFIG.APP_ID}:${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };

    proxyRequest(options, res);
}

// ===========================
// Proxy Helper
// ===========================
function proxyRequest(options, res, postData = null) {
    console.log(`[Proxy] ${options.method} https://${options.hostname}${options.path}`);
    
    const apiReq = https.request(options, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
            // Handle redirects (301, 302, 307, 308) automatically
            if ([301, 302, 307, 308].includes(apiRes.statusCode) && apiRes.headers.location) {
                console.log(`[Proxy] Following redirect (${apiRes.statusCode}) to: ${apiRes.headers.location}`);
                const redirectUrl = new URL(apiRes.headers.location, `https://${options.hostname}`);
                const redirectOptions = {
                    ...options,
                    hostname: redirectUrl.hostname,
                    path: redirectUrl.pathname + redirectUrl.search
                };
                return proxyRequest(redirectOptions, res, postData);
            }

            // Check if Fyers returned HTML instead of JSON (expired token, rate limit, error page)
            const trimmed = data.trim();
            if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
                // Check if it's a rate limit (Error 1015 / status 429)
                const isRateLimit = apiRes.statusCode === 429 || trimmed.includes('1015') || trimmed.includes('rate limit');
                
                if (isRateLimit) {
                    console.warn(`[Proxy] RATE LIMITED by Fyers/Cloudflare (status ${apiRes.statusCode}). Wait and retry.`);
                    res.writeHead(429, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        s: 'error',
                        code: -429,
                        message: 'Rate limited by Fyers. Please wait a few minutes before retrying.',
                        rateLimited: true
                    }));
                } else {
                    console.error(`[Proxy] Fyers returned HTML (status ${apiRes.statusCode}). Token may be expired.`);
                    console.error(`[Proxy] Response preview: ${trimmed.substring(0, 200)}`);
                    
                    // Invalidate token — it's likely expired
                    ACCESS_TOKEN = null;
                    try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); } catch (e) {}
                    
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        s: 'error',
                        code: -401,
                        message: 'Fyers token expired or invalid. Please re-login.',
                        needsReauth: true
                    }));
                }
                return;
            }
            
            // Valid JSON response from Fyers
            console.log(`[Proxy] Response (status ${apiRes.statusCode}): ${trimmed.substring(0, 200)}`);
            res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
            res.end(data);
        });
    });

    apiReq.on('error', (e) => {
        console.error(`[Proxy] Request error: ${e.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
    });

    if (postData) apiReq.write(postData);
    apiReq.end();
}

// ===========================
// Start Server
// ===========================
server.listen(CONFIG.PORT, () => {
    const hostUrl = process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${CONFIG.PORT}`;
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║          🎯 Hero Strike — Fyers Live Server         ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  Server running at: ${hostUrl.padEnd(32)} ║`);
    console.log('║                                                      ║');
    
    if (!CONFIG.APP_ID || !CONFIG.SECRET_KEY) {
        console.log('║  ⚠️  API credentials NOT configured!                 ║');
        console.log('║                                                      ║');
        console.log('║  Steps to configure:                                 ║');
        console.log('║  1. Open fyers-server.js                             ║');
        console.log('║  2. Fill in APP_ID and SECRET_KEY                    ║');
        console.log('║  3. Restart the server                               ║');
    } else {
        console.log(`║  App ID: ${CONFIG.APP_ID.substring(0, 15).padEnd(15)}                        ║`);
        console.log('║  Status: ✅ Credentials configured                   ║');
        console.log('║                                                      ║');
        console.log('║  Open the URL above and click "Login with Fyers"     ║');
    }
    
    console.log('║                                                      ║');
    console.log('║  Fyers Dashboard: https://myapi.fyers.in             ║');
    console.log(`║  Redirect URL:    ${CONFIG.REDIRECT_URI}    ║`);
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
});
