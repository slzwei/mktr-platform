import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const spacesConfig = {
  key: process.env.DO_SPACES_KEY,
  secret: process.env.DO_SPACES_SECRET,
  region: process.env.DO_SPACES_REGION,
  endpoint: process.env.DO_SPACES_ENDPOINT,
  bucket: process.env.DO_SPACES_BUCKET,
  cdnBase: process.env.DO_SPACES_CDN_BASE
};

let s3Client = null;

function isEnabled() {
  return Boolean(spacesConfig.key && spacesConfig.secret && spacesConfig.region && spacesConfig.endpoint && spacesConfig.bucket);
}

function getS3() {
  if (!isEnabled()) return null;
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: spacesConfig.region,
    endpoint: spacesConfig.endpoint,
    forcePathStyle: false,
    credentials: {
      accessKeyId: spacesConfig.key,
      secretAccessKey: spacesConfig.secret
    }
  });
  return s3Client;
}

function publicUrl(key) {
  if (spacesConfig.cdnBase) {
    return `${spacesConfig.cdnBase.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
  }
  try {
    const endpointHost = new URL(spacesConfig.endpoint).host; // e.g., sgp1.digitaloceanspaces.com
    return `https://${spacesConfig.bucket}.${endpointHost}/${key.replace(/^\//, '')}`;
  } catch {
    return `https://${spacesConfig.bucket}.${spacesConfig.region}.digitaloceanspaces.com/${key.replace(/^\//, '')}`;
  }
}

export const storageService = {
  isEnabled,
  publicUrl,
  async uploadBuffer(key, buffer, contentType = 'application/octet-stream', cacheControl = 'public, max-age=31536000') {
    const s3 = getS3();
    if (!s3) throw new Error('Spaces not configured');
    const cleanKey = key.replace(/^\//, '');
    await s3.send(new PutObjectCommand({
      Bucket: spacesConfig.bucket,
      Key: cleanKey,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read',
      CacheControl: cacheControl
    }));
    return publicUrl(cleanKey);
  },
  async deleteObject(key) {
    const s3 = getS3();
    if (!s3) throw new Error('Spaces not configured');
    const cleanKey = key.replace(/^\//, '');
    await s3.send(new DeleteObjectCommand({
      Bucket: spacesConfig.bucket,
      Key: cleanKey
    }));
    return true;
  }
};


