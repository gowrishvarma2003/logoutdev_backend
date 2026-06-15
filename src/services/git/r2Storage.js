const fs = require('fs');
const path = require('path');
const {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');

let client = null;

function getEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function isR2Enabled() {
  const driver = getEnv('REPO_STORAGE_DRIVER', 'GIT_STORAGE_DRIVER').toLowerCase();
  return driver === 'r2' || Boolean(getEnv('CLOUDFLARE_R2_BUCKET', 'R2_BUCKET'));
}

function getR2Config() {
  const accountId = getEnv('CLOUDFLARE_R2_ACCOUNT_ID', 'R2_ACCOUNT_ID');
  const endpoint = getEnv('CLOUDFLARE_R2_ENDPOINT', 'R2_ENDPOINT')
    || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const bucket = getEnv('CLOUDFLARE_R2_BUCKET', 'R2_BUCKET');
  const accessKeyId = getEnv('CLOUDFLARE_R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID');
  const secretAccessKey = getEnv('CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY');
  const prefix = getEnv('CLOUDFLARE_R2_REPO_PREFIX', 'R2_REPO_PREFIX') || 'git-repos';

  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    prefix: prefix.replace(/^\/+|\/+$/g, ''),
  };
}

function getClient() {
  if (client) return client;

  const config = getR2Config();
  if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error('Cloudflare R2 repo storage is enabled but R2 credentials are incomplete.');
  }

  client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return client;
}

function getRepoIdFromPath(repoPath) {
  const name = path.basename(repoPath || '');
  return name.endsWith('.git') ? name.slice(0, -4) : name;
}

function getRepoPrefix(repoPath) {
  const { prefix } = getR2Config();
  const repoId = getRepoIdFromPath(repoPath);
  return `${prefix ? `${prefix}/` : ''}repos/${repoId}/`;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function listRemoteObjects(repoPath) {
  const config = getR2Config();
  const r2 = getClient();
  const prefix = getRepoPrefix(repoPath);
  const objects = [];
  let ContinuationToken;

  do {
    const response = await r2.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: prefix,
      ContinuationToken,
    }));

    for (const item of response.Contents || []) {
      if (item.Key) objects.push(item.Key);
    }

    ContinuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (ContinuationToken);

  return objects;
}

async function walkFiles(root) {
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function hydrateRepoFromR2(repoPath) {
  if (!isR2Enabled()) return false;

  const config = getR2Config();
  const r2 = getClient();
  const prefix = getRepoPrefix(repoPath);
  const keys = await listRemoteObjects(repoPath);

  if (keys.length === 0) return false;

  await fs.promises.mkdir(repoPath, { recursive: true });

  for (const key of keys) {
    const relativePath = key.slice(prefix.length);
    if (!relativePath) continue;

    const destination = path.join(repoPath, relativePath);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });

    const response = await r2.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }));
    const body = await streamToBuffer(response.Body);
    await fs.promises.writeFile(destination, body);
  }

  return true;
}

async function syncRepoToR2(repoPath) {
  if (!isR2Enabled()) return false;

  const config = getR2Config();
  const r2 = getClient();
  const prefix = getRepoPrefix(repoPath);
  const localFiles = await walkFiles(repoPath);
  const localKeys = new Set();

  for (const filePath of localFiles) {
    const relativePath = path.relative(repoPath, filePath).split(path.sep).join('/');
    const key = `${prefix}${relativePath}`;
    localKeys.add(key);

    await r2.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: await fs.promises.readFile(filePath),
    }));
  }

  const remoteKeys = await listRemoteObjects(repoPath);
  const staleKeys = remoteKeys.filter((key) => !localKeys.has(key));

  for (let index = 0; index < staleKeys.length; index += 1000) {
    const batch = staleKeys.slice(index, index + 1000);
    if (batch.length === 0) continue;

    await r2.send(new DeleteObjectsCommand({
      Bucket: config.bucket,
      Delete: {
        Objects: batch.map((Key) => ({ Key })),
        Quiet: true,
      },
    }));
  }

  return true;
}

module.exports = {
  isR2Enabled,
  hydrateRepoFromR2,
  syncRepoToR2,
  _private: {
    getR2Config,
    getRepoPrefix,
  },
};
