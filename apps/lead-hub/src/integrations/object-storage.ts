import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../config.js';

export const maxStoredPhotoCount = 5;
export const maxStoredPhotoSizeBytes = 10 * 1_024 * 1_024;

const typeToExtension: ReadonlyMap<string, string> = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
]);

export interface PhotoUploadDescriptor {
  contentType: string;
  size: number;
  sha256: string;
}

export interface PreparedPhotoUpload {
  ref: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

export interface ObjectStorage {
  prepareUploads(submissionId: string, files: PhotoUploadDescriptor[]): Promise<PreparedPhotoUpload[]>;
  createDownloadUrls(references: string[]): Promise<string[]>;
  isReferenceForSubmission(reference: string, submissionId: string): boolean;
}

export class PhotoUploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoUploadValidationError';
  }
}

type StorageConfig = NonNullable<AppConfig['objectStorage']>;
type SignedUrlFactory = typeof getSignedUrl;

interface ObjectStorageDependencies {
  client?: S3Client;
  signedUrlFactory?: SignedUrlFactory;
  now?: () => Date;
}

export function createObjectStorage(
  config: StorageConfig,
  dependencies: ObjectStorageDependencies = {},
): ObjectStorage {
  const client = dependencies.client || new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  const sign = dependencies.signedUrlFactory || getSignedUrl;
  const now = dependencies.now || (() => new Date());

  return {
    async prepareUploads(submissionId, files) {
      validateSubmissionId(submissionId);
      validatePhotoUploadDescriptors(files);

      return Promise.all(
        files.map(async (file, index) => {
          const key = buildPhotoObjectKey(config.prefix, submissionId, file, index, now());
          const uploadUrl = await sign(
            client,
            new PutObjectCommand({
              Bucket: config.bucket,
              Key: key,
              ContentType: file.contentType,
              ContentLength: file.size,
            }),
            { expiresIn: config.uploadTtlSeconds },
          );

          return {
            ref: buildPhotoReference(config.bucket, key),
            uploadUrl,
            headers: { 'content-type': file.contentType },
          };
        }),
      );
    },

    async createDownloadUrls(references) {
      return Promise.all(
        references.map(async (reference) => {
          const key = parsePhotoReference(reference, config.bucket, config.prefix);
          if (!key) throw new PhotoUploadValidationError('Invalid photo reference.');

          return sign(
            client,
            new GetObjectCommand({ Bucket: config.bucket, Key: key }),
            { expiresIn: config.downloadTtlSeconds },
          );
        }),
      );
    },

    isReferenceForSubmission(reference, submissionId) {
      const key = parsePhotoReference(reference, config.bucket, config.prefix);
      if (!key || !isValidSubmissionId(submissionId)) return false;
      const relativeKey = key.slice(config.prefix.length);
      const [, , submissionHash] = relativeKey.split('/');
      return submissionHash === hashValue(submissionId);
    },
  };
}

export function validatePhotoUploadDescriptors(files: PhotoUploadDescriptor[]) {
  if (!files.length || files.length > maxStoredPhotoCount) {
    throw new PhotoUploadValidationError(`Expected 1-${maxStoredPhotoCount} photos.`);
  }

  for (const file of files) {
    if (!typeToExtension.has(file.contentType)) {
      throw new PhotoUploadValidationError('Unsupported photo content type.');
    }
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > maxStoredPhotoSizeBytes) {
      throw new PhotoUploadValidationError('Invalid photo size.');
    }
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new PhotoUploadValidationError('Invalid photo digest.');
    }
  }
}

export function buildPhotoObjectKey(
  prefix: string,
  submissionId: string,
  file: PhotoUploadDescriptor,
  index: number,
  date = new Date(),
) {
  validateSubmissionId(submissionId);
  const extension = typeToExtension.get(file.contentType);
  if (!extension) throw new PhotoUploadValidationError('Unsupported photo content type.');
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${prefix}${year}/${month}/${hashValue(submissionId)}/${index + 1}-${file.sha256.slice(0, 32)}.${extension}`;
}

export function buildPhotoReference(bucket: string, key: string) {
  return `b2://${bucket}/${key}`;
}

export function parsePhotoReference(reference: string, bucket: string, prefix: string) {
  const marker = `b2://${bucket}/`;
  if (!reference.startsWith(marker)) return null;
  const key = reference.slice(marker.length);
  if (!key.startsWith(prefix)) return null;

  const relative = key.slice(prefix.length);
  const parts = relative.split('/');
  if (parts.length !== 4) return null;
  const [year, month, submissionHash, fileName] = parts;
  if (!/^\d{4}$/.test(year || '')) return null;
  if (!/^(0[1-9]|1[0-2])$/.test(month || '')) return null;
  if (!/^[a-f0-9]{64}$/.test(submissionHash || '')) return null;
  if (!/^[1-5]-[a-f0-9]{32}\.(jpg|png|webp|heic|heif)$/.test(fileName || '')) return null;
  return key;
}

function validateSubmissionId(submissionId: string) {
  if (!isValidSubmissionId(submissionId)) {
    throw new PhotoUploadValidationError('Invalid submission identifier.');
  }
}

function isValidSubmissionId(submissionId: string) {
  return /^[A-Za-z0-9_-]{8,160}$/.test(submissionId);
}

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
