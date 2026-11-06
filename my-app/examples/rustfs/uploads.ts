import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { z } from "zod";
import { deleteObject, presignDownload, presignUpload, sizeOf } from "./s3.js";

// #region routes
const BUCKET = "uploads";
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "application/pdf"];

const askForUpload = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.enum(ALLOWED as [string, ...string[]]),
});

interface FileRow {
  id: string;
  key: string;
  fileName: string;
  size: number;
}

/** Stands in for a table in your database. Store the key, never a URL. */
export const files = new Map<string, FileRow>();

export function buildUploadApi() {
  const app = Fastify();

  // Step 1: the browser asks for permission, and the API hands back a URL.
  app.post("/uploads", async (req) => {
    const { fileName, contentType } = askForUpload.parse(req.body);
    const id = randomUUID();
    // A generated key stops users overwriting each other or choosing paths.
    const key = `files/${id}`;
    return { id, key, fileName, uploadUrl: await presignUpload(BUCKET, key, contentType) };
  });

  // Step 2: after the PUT, the browser reports back and the API checks it.
  // The signature does not limit size, so verify here and reject what is too big.
  app.post<{ Params: { id: string } }>("/uploads/:id/complete", async (req, reply) => {
    const { key, fileName } = z
      .object({ key: z.string().startsWith(`files/${req.params.id}`), fileName: z.string() })
      .parse(req.body);
    const size = await sizeOf(BUCKET, key);
    if (size > MAX_BYTES) {
      await deleteObject(BUCKET, key);
      return reply.code(413).send({ error: "file too large" });
    }
    files.set(req.params.id, { id: req.params.id, key, fileName, size });
    return { ok: true, size };
  });

  // Step 3: reading goes through a fresh short-lived link.
  app.get<{ Params: { id: string } }>("/files/:id", async (req, reply) => {
    const file = files.get(req.params.id);
    if (!file) return reply.code(404).send({ error: "not found" });
    return { url: await presignDownload(BUCKET, file.key), fileName: file.fileName };
  });

  return app;
}
// #endregion
