// Advisor flow server — serves the Arabic advisor UI and flow config APIs.
// Usage: node advisor/server.js
// Then open http://localhost:3001

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FLOWS_DIR = path.join(ROOT, 'flows', 'constructor');

const PORT = process.env.PORT || 3001;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendJSON(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendError(res, code, message) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: message }));
}

function serveStatic(req, res) {
  const filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const fullPath = path.join(__dirname, filePath);

  if (!fullPath.startsWith(__dirname)) {
    sendError(res, 403, 'Forbidden');
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME[ext] || 'text/plain; charset=utf-8';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      sendError(res, 404, 'Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function handleAPI(req, res) {
  const url = req.url.split('?')[0];

  // GET /api/meta
  if (url === '/api/meta') {
    const metaPath = path.join(FLOWS_DIR, '_meta.json');
    try {
      const data = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      sendJSON(res, data);
    } catch (e) {
      sendError(res, 500, 'Failed to load meta');
    }
    return;
  }

  // GET /api/majors
  if (url === '/api/majors') {
    const majorsPath = path.join(FLOWS_DIR, 'shared', 'majors.json');
    try {
      const data = JSON.parse(fs.readFileSync(majorsPath, 'utf8'));
      sendJSON(res, data);
    } catch (e) {
      sendError(res, 500, 'Failed to load majors');
    }
    return;
  }

  // GET /api/flow/:pathId
  const flowMatch = url.match(/^\/api\/flow\/([a-z_]+)$/);
  if (flowMatch) {
    const pathId = flowMatch[1];
    const flowPath = path.join(FLOWS_DIR, `${pathId}.json`);
    try {
      if (!fs.existsSync(flowPath)) {
        sendError(res, 404, 'Flow not found');
        return;
      }
      const data = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
      sendJSON(res, data);
    } catch (e) {
      sendError(res, 500, 'Failed to load flow');
    }
    return;
  }

  sendError(res, 404, 'API endpoint not found');
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/api/')) {
    handleAPI(req, res);
  } else if (req.method === 'GET') {
    serveStatic(req, res);
  } else {
    sendError(res, 405, 'Method not allowed');
  }
});

server.listen(PORT, () => {
  console.log(`Advisor server running at http://localhost:${PORT}`);
});
