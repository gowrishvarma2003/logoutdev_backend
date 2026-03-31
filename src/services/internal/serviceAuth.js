const crypto = require('crypto');

const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;

function getSharedSecret() {
  return String(process.env.INTERNAL_SERVICE_SHARED_SECRET || '').trim();
}

function getServiceId() {
  return String(process.env.INTERNAL_SERVICE_ID || 'logoutdev-backend').trim();
}

function buildSignaturePayload({ method, path, timestamp }) {
  return [String(timestamp || ''), String(method || '').toUpperCase(), String(path || '')].join('\n');
}

function signServiceRequest({ method, path, timestamp, secret = getSharedSecret() }) {
  if (!secret) {
    throw new Error('INTERNAL_SERVICE_SHARED_SECRET is not configured.');
  }

  return crypto
    .createHmac('sha256', secret)
    .update(buildSignaturePayload({ method, path, timestamp }))
    .digest('hex');
}

function buildServiceAuthHeaders({ method, path, serviceId = getServiceId(), timestamp = Date.now(), secret } = {}) {
  const normalizedPath = path && path.startsWith('/') ? path : `/${String(path || '').replace(/^\/+/, '')}`;
  return {
    'x-logoutdev-service-id': serviceId,
    'x-logoutdev-timestamp': String(timestamp),
    'x-logoutdev-signature': signServiceRequest({
      method,
      path: normalizedPath,
      timestamp,
      secret,
    }),
  };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyServiceRequest(req, options = {}) {
  const secret = options.secret || getSharedSecret();
  const allowlist = new Set(
    (options.allowedServiceIds || [])
      .concat(String(process.env.INTERNAL_SERVICE_ALLOWLIST || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean))
  );

  if (!secret) {
    return { ok: false, error: 'Internal service auth is not configured.' };
  }

  const serviceId = String(req.headers['x-logoutdev-service-id'] || '').trim();
  const timestamp = String(req.headers['x-logoutdev-timestamp'] || '').trim();
  const signature = String(req.headers['x-logoutdev-signature'] || '').trim();

  if (!serviceId || !timestamp || !signature) {
    return { ok: false, error: 'Missing internal service authentication headers.' };
  }

  if (allowlist.size > 0 && !allowlist.has(serviceId)) {
    return { ok: false, error: 'Internal service is not allowed.' };
  }

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) {
    return { ok: false, error: 'Invalid internal service timestamp.' };
  }

  if (Math.abs(Date.now() - timestampNumber) > (options.clockSkewMs || DEFAULT_CLOCK_SKEW_MS)) {
    return { ok: false, error: 'Internal service request expired.' };
  }

  const expectedSignature = signServiceRequest({
    method: req.method,
    path: req.originalUrl || req.url,
    timestamp,
    secret,
  });

  if (!safeEqual(signature, expectedSignature)) {
    return { ok: false, error: 'Invalid internal service signature.' };
  }

  return {
    ok: true,
    serviceId,
    timestamp: timestampNumber,
  };
}

module.exports = {
  buildServiceAuthHeaders,
  getServiceId,
  signServiceRequest,
  verifyServiceRequest,
};
