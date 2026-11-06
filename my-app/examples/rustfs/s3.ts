// #region client
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

// RustFS speaks the S3 API, so this is the ordinary AWS SDK. Only the endpoint
// and credentials say which server you are talking to.
export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  region: process.env.S3_REGION ?? "us-east-1",
  // Path style means http://host/bucket/key, which works without wildcard DNS.
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "devaccess",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "devsecret123",
  },
});
// #endregion

// #region bucket
/** Safe to call on every boot: it only creates the bucket when it is missing. */
export async function ensureBucket(bucket: string) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}
// #endregion

// #region put-get
export function putText(bucket: string, key: string, body: string) {
  return s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "text/plain" }),
  );
}

export async function getText(bucket: string, key: string) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return res.Body!.transformToString();
}
// #endregion

// #region presign
/**
 * The browser uploads straight to storage, so large files never pass through
 * your API. The URL is signed for one key, one content type and a few minutes.
 */
export function presignUpload(bucket: string, key: string, contentType: string) {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  return getSignedUrl(s3, command, { expiresIn: 300 });
}

/** Keep the bucket private and hand out short-lived links to each file. */
export function presignDownload(bucket: string, key: string) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 });
}
// #endregion

// #region multipart
/**
 * Upload splits a stream into parts and sends several at once. A failed part
 * is retried alone, and memory stays near partSize × queueSize.
 */
export function uploadLargeFile(bucket: string, key: string, body: Readable) {
  const upload = new Upload({
    client: s3,
    params: { Bucket: bucket, Key: key, Body: body },
    partSize: 8 * 1024 * 1024,
    queueSize: 4,
  });
  return upload.done();
}
// #endregion

// #region list-delete
/** Keys are flat strings. A "folder" is only a shared prefix. */
export async function listKeys(bucket: string, prefix: string) {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  return (res.Contents ?? []).map((o) => o.Key!);
}

export async function sizeOf(bucket: string, key: string) {
  const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return res.ContentLength ?? 0;
}

export const deleteObject = (bucket: string, key: string) =>
  s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
// #endregion
