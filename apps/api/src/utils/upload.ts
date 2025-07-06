import { Client } from 'minio';
import { buffer } from 'node:stream/consumers';

export const minio = new Client({
  endPoint: 'fsn1.your-objectstorage.com',
  port: 443,
  useSSL: true,
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
  region: 'eu-central',
});

export async function uploadFile(file: File, name: string) {
  const bucket = 'apiref';
  const fileName = `specs/${name}.json`;
  await minio.putObject(
    bucket,
    fileName,
    await buffer(file.stream()),
    undefined,
    { 'Content-Type': file.type },
  );
  return `https://fsn1.your-objectstorage.com/${bucket}/${fileName}`;
}
