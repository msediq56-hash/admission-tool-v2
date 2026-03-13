// Minimal prototype server for manual evaluation testing.
// Usage: node prototype/server.js
// Then open http://localhost:3000

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { evaluate } from '../engine/evaluate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load static data once at startup
const ruleSet = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules/constructor_bachelor_rules.json'), 'utf8'));
const referenceTables = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/reference_tables.json'), 'utf8'));
const universities = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/universities.json'), 'utf8'));
const programs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/programs.json'), 'utf8'));

const university = universities.universities.find(u => u.university_id === 'constructor_university');
const program = programs.programs.find(p => p.program_id === 'cs_bachelor');

const PORT = 3000;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json'
};

function serveStatic(req, res) {
  const filePath = req.url === '/' ? '/index.html' : req.url;
  const fullPath = path.join(__dirname, filePath);

  // Only serve files from prototype/
  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME[ext] || 'text/plain';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function handleEvaluate(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const applicant = JSON.parse(body);

      // Construct evaluation context
      const context = {
        applicant,
        evaluation_scope: {
          mode: 'single_program',
          targets: [{
            university: {
              university_id: university.university_id,
              name: university.name,
              country: university.country,
              type: university.type,
              supported_languages: university.supported_languages
            },
            program: {
              program_id: program.program_id,
              name: program.name,
              degree_level: program.degree_level,
              language_of_instruction: program.language_of_instruction,
              prerequisite_subjects: program.prerequisite_subjects
            },
            rule_set: ruleSet
          }]
        },
        evaluation_date: new Date().toISOString().split('T')[0]
      };

      const result = evaluate(context, referenceTables);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result, null, 2));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/evaluate') {
    handleEvaluate(req, res);
  } else if (req.method === 'GET') {
    serveStatic(req, res);
  } else {
    res.writeHead(405);
    res.end('Method not allowed');
  }
});

server.listen(PORT, () => {
  console.log(`Prototype server running at http://localhost:${PORT}`);
});
