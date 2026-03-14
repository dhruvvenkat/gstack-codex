/**
 * Tiny HTTP server for test fixtures
 * Serves HTML files from test/fixtures/ on a random available port
 */

import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

const FIXTURES_DIR = path.resolve(import.meta.dir, 'fixtures');

export interface FixtureServer {
  server: {
    port: number;
    stop(): void;
  };
  url: string;
}

function createHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const url = new URL(req.url || '/', 'http://127.0.0.1');

  // Echo endpoint — returns request headers as JSON
  if (url.pathname === '/echo') {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value || '';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(headers, null, 2));
    return;
  }

  let filePath = url.pathname === '/' ? '/basic.html' : url.pathname;

  // Remove leading slash
  filePath = filePath.replace(/^\//, '');
  const fullPath = path.join(FIXTURES_DIR, filePath);

  if (!fs.existsSync(fullPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const ext = path.extname(fullPath);
  const contentType = ext === '.html' ? 'text/html' : 'text/plain';
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
}

async function listenOnPort(port: number): Promise<FixtureServer> {
  const server = http.createServer(createHandler);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to resolve fixture server address');
  }

  const wrappedServer = {
    port: address.port,
    stop() {
      server.close();
    },
  };

  const url = `http://127.0.0.1:${wrappedServer.port}`;
  return { server: wrappedServer, url };
}

export async function startTestServer(port: number = 0): Promise<FixtureServer> {
  if (port !== 0) {
    return listenOnPort(port);
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = 20000 + Math.floor(Math.random() * 30000);
    try {
      return await listenOnPort(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to start fixture server on an available port');
}

// If run directly, start and print URL
if (import.meta.main) {
  const { url } = await startTestServer(9450);
  console.log(`Test server running at ${url}`);
  console.log(`Fixtures: ${FIXTURES_DIR}`);
  console.log('Press Ctrl+C to stop');
}
