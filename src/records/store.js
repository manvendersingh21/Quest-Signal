import { randomBytes } from "node:crypto";

/**
 * Visitor records: apprentices a mentor or program entered on /new.
 *
 * With BLOB_READ_WRITE_TOKEN set (Vercel Blob, private store), each record is one
 * private blob at records/<id>.json, written once and never overwritten. There is
 * no index blob and no list route, so a record is reachable only by its link.
 * Without the token (tests, local runs), records live in this process only.
 */

export const VISITOR_LABEL = "Entered by a visitor. Not verified by TradesQuest.";
export const RECORD_ID = /^r-[a-z0-9]{12}$/;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const memory = new Map();

export function isRecordId(id) {
  return RECORD_ID.test(String(id || ""));
}

export function newRecordId() {
  const bytes = randomBytes(12);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `r-${out}`;
}

export function recordStoreKind() {
  return process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "memory";
}

function blobPath(id) {
  return `records/${id}.json`;
}

/** Writes a new record once. Throws if the id is malformed or already taken. */
export async function saveRecord(record) {
  if (!isRecordId(record?.id)) throw new Error("Record id is malformed.");
  if (recordStoreKind() === "memory") {
    if (memory.has(record.id)) throw new Error("Record id already exists.");
    memory.set(record.id, JSON.stringify(record));
    return record;
  }
  const { put } = await import("@vercel/blob");
  await put(blobPath(record.id), JSON.stringify(record), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json",
  });
  return record;
}

/** @returns {Promise<object|null>} the stored record, or null when there is none. */
export async function getRecord(id) {
  if (!isRecordId(id)) return null;
  if (recordStoreKind() === "memory") {
    const raw = memory.get(id);
    return raw ? JSON.parse(raw) : null;
  }
  const { get } = await import("@vercel/blob");
  let result;
  try {
    // Records are write-once; reading from origin avoids a miss right after the 303.
    result = await get(blobPath(id), { access: "private", useCache: false });
  } catch (error) {
    if (error?.name === "BlobNotFoundError" || /not found/i.test(String(error?.message))) return null;
    throw error;
  }
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}
