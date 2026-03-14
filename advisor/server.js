// Advisor flow server — serves the Arabic advisor UI and flow config APIs.
// Supports multiple universities via flows/{universityId}/ folders.
// Usage: node advisor/server.js
// Then open http://localhost:3001

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FLOWS_ROOT = path.join(ROOT, 'flows');

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

// Validate university ID to prevent path traversal
function isValidId(id) {
  return /^[a-z][a-z0-9_]*$/.test(id);
}

function handleAPI(req, res) {
  const url = req.url.split('?')[0];

  // GET /api/universities — list all available universities
  if (url === '/api/universities') {
    try {
      const entries = fs.readdirSync(FLOWS_ROOT, { withFileTypes: true });
      const universities = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const metaPath = path.join(FLOWS_ROOT, entry.name, '_meta.json');
        if (!fs.existsSync(metaPath)) continue;
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        universities.push({
          id: entry.name,
          label: meta.university_label,
          country: meta.country,
          university_type: meta.university_type,
          country_label: meta.country_label
        });
      }
      sendJSON(res, { universities });
    } catch (e) {
      sendError(res, 500, 'Failed to list universities');
    }
    return;
  }

  // GET /api/:universityId/meta
  const metaMatch = url.match(/^\/api\/([a-z_]+)\/meta$/);
  if (metaMatch) {
    const uniId = metaMatch[1];
    if (!isValidId(uniId)) { sendError(res, 400, 'Invalid university ID'); return; }
    const metaPath = path.join(FLOWS_ROOT, uniId, '_meta.json');
    try {
      if (!fs.existsSync(metaPath)) { sendError(res, 404, 'University not found'); return; }
      sendJSON(res, JSON.parse(fs.readFileSync(metaPath, 'utf8')));
    } catch (e) {
      sendError(res, 500, 'Failed to load meta');
    }
    return;
  }

  // GET /api/:universityId/majors
  const majorsMatch = url.match(/^\/api\/([a-z_]+)\/majors$/);
  if (majorsMatch) {
    const uniId = majorsMatch[1];
    if (!isValidId(uniId)) { sendError(res, 400, 'Invalid university ID'); return; }
    const majorsPath = path.join(FLOWS_ROOT, uniId, 'shared', 'majors.json');
    try {
      if (!fs.existsSync(majorsPath)) {
        // Not all universities have majors — return empty
        sendJSON(res, { majors: [] });
        return;
      }
      sendJSON(res, JSON.parse(fs.readFileSync(majorsPath, 'utf8')));
    } catch (e) {
      sendError(res, 500, 'Failed to load majors');
    }
    return;
  }

  // GET /api/:universityId/shared/:fileName — generic shared data files
  const sharedMatch = url.match(/^\/api\/([a-z_]+)\/shared\/([a-z_]+)$/);
  if (sharedMatch) {
    const uniId = sharedMatch[1];
    const fileName = sharedMatch[2];
    if (!isValidId(uniId) || !isValidId(fileName)) { sendError(res, 400, 'Invalid ID'); return; }
    const filePath = path.join(FLOWS_ROOT, uniId, 'shared', `${fileName}.json`);
    try {
      if (!fs.existsSync(filePath)) { sendError(res, 404, 'Shared data not found'); return; }
      sendJSON(res, JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (e) {
      sendError(res, 500, 'Failed to load shared data');
    }
    return;
  }

  // GET /api/:universityId/flow/:pathId
  const flowMatch = url.match(/^\/api\/([a-z_]+)\/flow\/([a-z_]+)$/);
  if (flowMatch) {
    const uniId = flowMatch[1];
    const pathId = flowMatch[2];
    if (!isValidId(uniId) || !isValidId(pathId)) { sendError(res, 400, 'Invalid ID'); return; }
    const flowPath = path.join(FLOWS_ROOT, uniId, `${pathId}.json`);
    try {
      if (!fs.existsSync(flowPath)) { sendError(res, 404, 'Flow not found'); return; }
      sendJSON(res, JSON.parse(fs.readFileSync(flowPath, 'utf8')));
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
