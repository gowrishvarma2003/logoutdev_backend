const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

let cachedSupabaseClient = null;

function asTrimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeObjectKey(objectKey) {
  const normalized = String(objectKey || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) {
    throw new Error('Storage object key is required.');
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Invalid storage object key.');
  }

  
  return parts.join('/');
}

function getStorageProvider() {
  const configured = asTrimmed(process.env.FILE_STORAGE_PROVIDER || 'local').toLowerCase();
  return configured === 'supabase' ? 'supabase' : 'local';
}

function getLocalStorageRoot() {
  const configured = asTrimmed(process.env.FILE_STORAGE_LOCAL_ROOT);
  const defaultRoot = path.resolve(process.cwd(), 'file-storage');
  return configured
    ? (path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured))
    : defaultRoot;
}

function getSupabaseConfig() {
  return {
    url: asTrimmed(process.env.SUPABASE_URL),
    serviceRoleKey: asTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY),
    bucket: asTrimmed(process.env.SUPABASE_STORAGE_BUCKET),
  };
}

function ensureSupabaseConfigured() {
  const { url, serviceRoleKey, bucket } = getSupabaseConfig();
  if (!url || !serviceRoleKey || !bucket) {
    throw new Error('Supabase storage is not fully configured. Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET.');
  }

  return { url, serviceRoleKey, bucket };
}

function getSupabaseClient() {
  if (cachedSupabaseClient) {
    return cachedSupabaseClient;
  }

  const { url, serviceRoleKey } = ensureSupabaseConfigured();
  cachedSupabaseClient = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedSupabaseClient;
}

function isObjectNotFoundError(error) {
  const errorName = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  const originalError = error?.originalError;
  const originalErrorKeys = originalError && typeof originalError === 'object'
    ? Object.keys(originalError)
    : [];

  if (Number(error?.statusCode) === 404 || Number(error?.status) === 404) {
    return true;
  }

  if (Number(originalError?.statusCode) === 404 || Number(originalError?.status) === 404) {
    return true;
  }

  // Supabase download for missing keys can surface as StorageUnknownError: {}
  // with an empty originalError payload.
  if (errorName === 'storageunknownerror' && message === '{}' && originalErrorKeys.length === 0) {
    return true;
  }

  return message.includes('not found')
    || message.includes('no such')
    || message.includes('does not exist')
    || message.includes('404');
}

async function uploadBuffer(objectKey, content, options = {}) {
  const key = normalizeObjectKey(objectKey);
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content || '');

  if (getStorageProvider() === 'local') {
    const absolutePath = path.join(getLocalStorageRoot(), key);
    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, buffer);
    return {
      key,
      provider: 'local',
      bytes: buffer.length,
    };
  }

  const { bucket } = ensureSupabaseConfigured();
  const client = getSupabaseClient();
  const { error } = await client.storage.from(bucket).upload(key, buffer, {
    upsert: true,
    contentType: options.contentType || 'application/octet-stream',
    cacheControl: options.cacheControl || '3600',
  });

  if (error) {
    throw new Error(`Failed to upload storage object ${key}: ${error.message}`);
  }

  return {
    key,
    provider: 'supabase',
    bytes: buffer.length,
  };
}

async function downloadBuffer(objectKey) {
  const key = normalizeObjectKey(objectKey);

  if (getStorageProvider() === 'local') {
    const absolutePath = path.join(getLocalStorageRoot(), key);
    try {
      return await fs.promises.readFile(absolutePath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  const { bucket } = ensureSupabaseConfigured();
  const client = getSupabaseClient();
  const { data, error } = await client.storage.from(bucket).download(key);

  if (error) {
    if (isObjectNotFoundError(error)) {
      return null;
    }
    throw new Error(`Failed to download storage object ${key}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (typeof data.arrayBuffer === 'function') {
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  return Buffer.from(data);
}

async function removeObject(objectKey) {
  const key = normalizeObjectKey(objectKey);

  if (getStorageProvider() === 'local') {
    const absolutePath = path.join(getLocalStorageRoot(), key);
    try {
      await fs.promises.unlink(absolutePath);
      return true;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  const { bucket } = ensureSupabaseConfigured();
  const client = getSupabaseClient();
  const { error } = await client.storage.from(bucket).remove([key]);
  if (error) {
    throw new Error(`Failed to remove storage object ${key}: ${error.message}`);
  }
  return true;
}

async function objectExists(objectKey) {
  const key = normalizeObjectKey(objectKey);

  if (getStorageProvider() === 'local') {
    const absolutePath = path.join(getLocalStorageRoot(), key);
    try {
      await fs.promises.access(absolutePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  const data = await downloadBuffer(key);
  return Boolean(data);
}

async function uploadFile(localFilePath, objectKey, options = {}) {
  const content = await fs.promises.readFile(localFilePath);
  return uploadBuffer(objectKey, content, options);
}

async function downloadFile(objectKey, localFilePath) {
  const content = await downloadBuffer(objectKey);
  if (!content) {
    return false;
  }

  await fs.promises.mkdir(path.dirname(localFilePath), { recursive: true });
  await fs.promises.writeFile(localFilePath, content);
  return true;
}

module.exports = {
  getStorageProvider,
  getLocalStorageRoot,
  uploadBuffer,
  downloadBuffer,
  uploadFile,
  downloadFile,
  objectExists,
  removeObject,
};
