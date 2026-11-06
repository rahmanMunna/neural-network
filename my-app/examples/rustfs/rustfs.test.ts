import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { before, test } from "node:test";
import { Readable } from "node:stream";
import {
  deleteObject,
  ensureBucket,
  getText,
  listKeys,
  presignDownload,
  presignUpload,
  putText,
  sizeOf,
  uploadLargeFile,
} from "./s3.js";
import { buildUploadApi, files } from "./uploads.js";

const BUCKET = "examples";

before(async () => {
  await ensureBucket(BUCKET);
  await ensureBucket("uploads");
});

test("ensureBucket is safe to repeat", async () => {
  await ensureBucket(BUCKET);
});

test("put and get an object", async () => {
  await putText(BUCKET, "notes/a.txt", "hello");
  assert.equal(await getText(BUCKET, "notes/a.txt"), "hello");
});

test("a prefix behaves like a folder", async () => {
  await putText(BUCKET, "reports/1.txt", "x");
  await putText(BUCKET, "reports/2.txt", "y");
  assert.deepEqual(await listKeys(BUCKET, "reports/"), ["reports/1.txt", "reports/2.txt"]);
  await deleteObject(BUCKET, "reports/1.txt");
  assert.deepEqual(await listKeys(BUCKET, "reports/"), ["reports/2.txt"]);
});

test("presigned URLs work with no credentials", async () => {
  const put = await presignUpload(BUCKET, "direct/x.txt", "text/plain");
  const up = await fetch(put, { method: "PUT", body: "from browser", headers: { "content-type": "text/plain" } });
  assert.equal(up.status, 200);
  const get = await presignDownload(BUCKET, "direct/x.txt");
  assert.equal(await (await fetch(get)).text(), "from browser");
});

test("a private object cannot be read without a signature", async () => {
  await putText(BUCKET, "private.txt", "secret");
  const res = await fetch(`http://localhost:9000/${BUCKET}/private.txt`);
  assert.equal(res.status, 403);
});

test("a tampered presigned URL is rejected", async () => {
  const url = await presignDownload(BUCKET, "private.txt");
  const res = await fetch(url.replace("private.txt", "other.txt"));
  assert.equal(res.status, 403);
});

test("multipart upload handles a 20 MB stream", async () => {
  const size = 20 * 1024 * 1024;
  await uploadLargeFile(BUCKET, "big.bin", Readable.from([randomBytes(size)]));
  assert.equal(await sizeOf(BUCKET, "big.bin"), size);
});

test("the full browser upload flow", async () => {
  const api = buildUploadApi();
  const started = (await api.inject({
    method: "POST",
    url: "/uploads",
    payload: { fileName: "cv.pdf", contentType: "application/pdf" },
  })).json();
  const put = await fetch(started.uploadUrl, {
    method: "PUT",
    body: "pdf bytes",
    headers: { "content-type": "application/pdf" },
  });
  assert.equal(put.status, 200);
  const done = await api.inject({
    method: "POST",
    url: `/uploads/${started.id}/complete`,
    payload: { key: started.key, fileName: "cv.pdf" },
  });
  assert.equal(done.statusCode, 200);
  assert.equal(files.get(started.id)?.size, 9);
  const link = (await api.inject({ url: `/files/${started.id}` })).json();
  assert.equal(await (await fetch(link.url)).text(), "pdf bytes");
  await api.close();
});

test("a disallowed content type is refused before any URL is issued", async () => {
  const api = buildUploadApi();
  const res = await api.inject({
    method: "POST",
    url: "/uploads",
    payload: { fileName: "evil.exe", contentType: "application/x-msdownload" },
  });
  assert.ok(res.statusCode >= 400);
  await api.close();
});
