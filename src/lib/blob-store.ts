import { Storage } from '@google-cloud/storage';

let storage: Storage | null = null;

function getStorage(): Storage {
  if (!storage) {
    storage = new Storage();
  }
  return storage;
}

function bucketName(): string {
  const name = process.env.ROSIE_GCS_BUCKET;
  if (!name) {
    throw new Error('ROSIE_GCS_BUCKET is required');
  }
  return name;
}

export async function getBytes(pathname: string): Promise<Buffer | null> {
  try {
    const [bytes] = await getStorage().bucket(bucketName()).file(pathname).download();
    return bytes;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 404) {
      return null;
    }
    throw error;
  }
}

export async function putBytes(
  pathname: string,
  bytes: Buffer,
  contentType: string
): Promise<string> {
  await getStorage().bucket(bucketName()).file(pathname).save(bytes, {
    contentType,
    resumable: false,
  });
  return pathname;
}
