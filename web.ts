import mime from 'mime';
import { Client } from 'minio';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const client = new Client({
  endPoint: 'fsn1.your-objectstorage.com',
  port: 443,
  useSSL: true,
  accessKey: 'H3ND25VTX3ZWXFSTJVYH',
  secretKey: 'aNqWDOj2cF6YVhnWMC2WBNPg8Ih0KrjsolEzTFQT',
  region: 'eu-central',
});
async function emptyBucket(bucketName) {
  // List all objects recursively
  const stream = client.listObjectsV2(bucketName, '', true);
  const toDelete: string[] = [];

  for await (const obj of stream) {
    toDelete.push(obj.name);
  }

  // Remove each object
  await Promise.all(
    toDelete.map((key) => client.removeObject(bucketName, key)),
  );
  console.log(`Emptied bucket ${bucketName}`);
}

// Usage
emptyBucket('apiref');
async function uploadDir(dir: string, bucket: string, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });

  const promises = entries.map(async (entry) => {
    const full = join(dir, entry.name);
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      // Recursively upload directories
      return uploadDir(full, bucket, key);
    } else {
      // Upload files
      const contentType = mime.getType(full) || 'application/octet-stream';
      await client.fPutObject(bucket, key, full, {
        'Content-Type': contentType,
        'x-amz-website-redirect-location': '/packages/real-file-name-1.0.0.tgz',
      });
      console.log(`→ ${key} (${contentType})`);
    }
  });

  await Promise.all(promises);
}

// await uploadDir(
//   '/Users/ezzabuzaid/Desktop/January/sdk-it/packages/apiref/dist/client',
//   'apiref',
//   'demo',
// );
