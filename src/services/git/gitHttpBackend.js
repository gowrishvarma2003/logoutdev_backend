const { spawn } = require('child_process');
const { getGitStorageRoot } = require('./gitPath');

function parseGitHeaders(rawHeaders) {
  const lines = rawHeaders.split(/\r?\n/).filter(Boolean);
  const headers = {};
  let statusCode = 200;

  for (const line of lines) {
    const [name, ...valueParts] = line.split(':');
    if (!name || valueParts.length === 0) continue;
    const value = valueParts.join(':').trim();

    if (name.toLowerCase() === 'status') {
      const [code] = value.split(' ');
      statusCode = Number(code) || 200;
      continue;
    }

    headers[name] = value;
  }

  return { headers, statusCode };
}

function streamGitHttpBackend(req, res, options) {
  const gitProjectRoot = options.gitProjectRoot || getGitStorageRoot();
  const pathInfo = options.pathInfo || '/';

  const backend = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_HTTP_EXPORT_ALL: '1',
      GIT_PROJECT_ROOT: gitProjectRoot,
      PATH_INFO: pathInfo,
      REQUEST_METHOD: req.method,
      QUERY_STRING: req.url.includes('?') ? req.url.split('?')[1] : '',
      CONTENT_TYPE: req.headers['content-type'] || '',
      CONTENT_LENGTH: req.headers['content-length'] || '',
      REMOTE_USER: options.remoteUser || '',
      REMOTE_ADDR: req.ip || req.socket.remoteAddress || '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let headerBuffer = Buffer.alloc(0);
  let headersSent = false;

  backend.stdout.on('data', (chunk) => {
    if (headersSent) {
      res.write(chunk);
      return;
    }

    headerBuffer = Buffer.concat([headerBuffer, chunk]);
    const text = headerBuffer.toString('utf8');
    const separatorIndex = text.indexOf('\r\n\r\n') >= 0
      ? text.indexOf('\r\n\r\n')
      : text.indexOf('\n\n');

    if (separatorIndex === -1) {
      return;
    }

    const separatorLength = text.indexOf('\r\n\r\n') >= 0 ? 4 : 2;
    const rawHeaders = text.slice(0, separatorIndex);
    const consumedText = text.slice(0, separatorIndex + separatorLength);
    const bodyStart = headerBuffer.slice(Buffer.byteLength(consumedText));
    const { headers, statusCode } = parseGitHeaders(rawHeaders);

    res.status(statusCode);
    Object.entries(headers).forEach(([name, value]) => {
      res.setHeader(name, value);
    });
    headersSent = true;

    if (bodyStart.length > 0) {
      res.write(bodyStart);
    }
  });

  backend.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Git backend failed to start.' });
      return;
    }
    res.end();
  });

  backend.on('close', (code) => {
    if (!headersSent && !res.headersSent) {
      res.status(code === 0 ? 200 : 500).end();
      return;
    }
    res.end();
  });

  req.pipe(backend.stdin);
}

module.exports = {
  streamGitHttpBackend,
};
