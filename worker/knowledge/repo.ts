import type { KnowledgeDoc, KnowledgeVersion } from "../../shared/types";
import { all, batch, one, run } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/ids";
import { chunkDocument } from "./chunk";
import { blobToVector, embedTexts, vectorToBlob } from "./embed";
import type { ChunkForRetrieval } from "./retrieve";

type VersionRow = {
  id: string;
  company_id: string;
  number: number;
  title: string;
  status: "draft" | "active" | "archived";
  chunk_count: number;
  created_at: string;
  activated_at: string | null;
  doc_count?: number;
};

const toVersion = (r: VersionRow): KnowledgeVersion => ({
  id: r.id,
  number: r.number,
  title: r.title,
  status: r.status,
  chunkCount: r.chunk_count,
  docCount: r.doc_count ?? 0,
  createdAt: r.created_at,
  activatedAt: r.activated_at,
});

const VERSION_SELECT = `SELECT v.*, (SELECT COUNT(*) FROM knowledge_docs d WHERE d.version_id = v.id) AS doc_count FROM knowledge_versions v`;

export async function listVersions(db: D1Database, companyId: string): Promise<KnowledgeVersion[]> {
  const rows = await all<VersionRow>(db, `${VERSION_SELECT} WHERE v.company_id = ? ORDER BY v.number DESC`, companyId);
  return rows.map(toVersion);
}

export async function getVersion(db: D1Database, companyId: string, versionId: string): Promise<KnowledgeVersion | null> {
  const row = await one<VersionRow>(db, `${VERSION_SELECT} WHERE v.company_id = ? AND v.id = ?`, companyId, versionId);
  return row ? toVersion(row) : null;
}

export async function getActiveVersion(db: D1Database, companyId: string): Promise<KnowledgeVersion | null> {
  const row = await one<VersionRow>(db, `${VERSION_SELECT} WHERE v.company_id = ? AND v.status = 'active'`, companyId);
  return row ? toVersion(row) : null;
}

export async function getDraftVersion(db: D1Database, companyId: string): Promise<KnowledgeVersion | null> {
  const row = await one<VersionRow>(db, `${VERSION_SELECT} WHERE v.company_id = ? AND v.status = 'draft' ORDER BY v.number DESC LIMIT 1`, companyId);
  return row ? toVersion(row) : null;
}

/** New draft, optionally seeded with a copy of another version's docs and chunks (embeddings included, so no cost). */
export async function createDraft(db: D1Database, companyId: string, userId: string, fromVersionId: string | null, title: string): Promise<KnowledgeVersion> {
  const last = await one<{ n: number | null }>(db, "SELECT MAX(number) AS n FROM knowledge_versions WHERE company_id = ?", companyId);
  const number = (last?.n ?? 0) + 1;
  const id = newId("kv");
  await run(db, "INSERT INTO knowledge_versions (id, company_id, number, title, status, created_by) VALUES (?, ?, ?, ?, 'draft', ?)", id, companyId, number, title || `Version ${number}`, userId);
  if (fromVersionId) {
    const docs = await all<{ id: string; title: string; source_type: string; content: string; char_count: number }>(db, "SELECT id, title, source_type, content, char_count FROM knowledge_docs WHERE version_id = ? AND company_id = ?", fromVersionId, companyId);
    for (const doc of docs) {
      const newDocId = newId("kd");
      await run(db, "INSERT INTO knowledge_docs (id, version_id, company_id, title, source_type, content, char_count) VALUES (?, ?, ?, ?, ?, ?, ?)", newDocId, id, companyId, doc.title, doc.source_type, doc.content, doc.char_count);
      const chunks = await all<{ ordinal: number; heading: string; text: string; embedding: ArrayBuffer | null }>(db, "SELECT ordinal, heading, text, embedding FROM knowledge_chunks WHERE doc_id = ? ORDER BY ordinal", doc.id);
      await batch(
        db,
        chunks.map((chunk) => ({
          sql: "INSERT INTO knowledge_chunks (id, version_id, company_id, doc_id, ordinal, heading, text, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          params: [newId("kc"), id, companyId, newDocId, chunk.ordinal, chunk.heading, chunk.text, chunk.embedding ? new Uint8Array(chunk.embedding) : null],
        })),
      );
    }
    await recount(db, id);
  }
  return (await getVersion(db, companyId, id))!;
}

export async function listDocs(db: D1Database, versionId: string): Promise<KnowledgeDoc[]> {
  const rows = await all<{ id: string; title: string; source_type: string; char_count: number; created_at: string }>(db, "SELECT id, title, source_type, char_count, created_at FROM knowledge_docs WHERE version_id = ? ORDER BY created_at", versionId);
  return rows.map((r) => ({ id: r.id, title: r.title, sourceType: r.source_type, charCount: r.char_count, createdAt: r.created_at }));
}

export async function getDocContent(db: D1Database, versionId: string, docId: string) {
  return one<{ id: string; title: string; content: string }>(db, "SELECT id, title, content FROM knowledge_docs WHERE version_id = ? AND id = ?", versionId, docId);
}

async function recount(db: D1Database, versionId: string) {
  await run(db, "UPDATE knowledge_versions SET chunk_count = (SELECT COUNT(*) FROM knowledge_chunks WHERE version_id = ?) WHERE id = ?", versionId, versionId);
}

/** Chunk, embed, and store one document. Embeddings are optional: without an OpenAI key the chunks still work for keyword search. */
export async function addDoc(env: Env, input: { companyId: string; versionId: string; title: string; content: string; sourceType: string }) {
  const db = env.DB;
  const docId = newId("kd");
  const chunks = chunkDocument(input.title, input.content);
  const vectors = await embedTexts(env, chunks.map((c) => `${c.heading}\n${c.text}`));
  await run(db, "INSERT INTO knowledge_docs (id, version_id, company_id, title, source_type, content, char_count) VALUES (?, ?, ?, ?, ?, ?, ?)", docId, input.versionId, input.companyId, input.title, input.sourceType, input.content, input.content.length);
  await batch(
    db,
    chunks.map((chunk, index) => ({
      sql: "INSERT INTO knowledge_chunks (id, version_id, company_id, doc_id, ordinal, heading, text, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      params: [newId("kc"), input.versionId, input.companyId, docId, chunk.ordinal, chunk.heading, chunk.text, vectors ? vectorToBlob(vectors[index]) : null],
    })),
  );
  await recount(db, input.versionId);
  return { docId, chunkCount: chunks.length, embedded: Boolean(vectors) };
}

export async function deleteDoc(db: D1Database, versionId: string, docId: string) {
  await run(db, "DELETE FROM knowledge_chunks WHERE version_id = ? AND doc_id = ?", versionId, docId);
  await run(db, "DELETE FROM knowledge_docs WHERE version_id = ? AND id = ?", versionId, docId);
  await recount(db, versionId);
}

export async function deleteVersion(db: D1Database, companyId: string, versionId: string) {
  await run(db, "DELETE FROM knowledge_versions WHERE company_id = ? AND id = ? AND status != 'active'", companyId, versionId);
}

/** Makes `versionId` the one the agent reads. The previous active version is archived and can be re-activated later (rollback). */
export async function activateVersion(db: D1Database, companyId: string, versionId: string) {
  const now = new Date().toISOString();
  await batch(db, [
    { sql: "UPDATE knowledge_versions SET status = 'archived' WHERE company_id = ? AND status = 'active' AND id != ?", params: [companyId, versionId] },
    { sql: "UPDATE knowledge_versions SET status = 'active', activated_at = ? WHERE company_id = ? AND id = ?", params: [now, companyId, versionId] },
  ]);
}

export async function loadChunks(db: D1Database, versionId: string): Promise<ChunkForRetrieval[]> {
  const rows = await all<{ id: string; doc_id: string; heading: string; text: string; embedding: ArrayBuffer | null }>(db, "SELECT id, doc_id, heading, text, embedding FROM knowledge_chunks WHERE version_id = ?", versionId);
  return rows.map((r) => ({ id: r.id, docId: r.doc_id, heading: r.heading, text: r.text, embedding: blobToVector(r.embedding) }));
}

export async function previewChunks(db: D1Database, versionId: string, docId: string | null, limit = 50) {
  const rows = docId
    ? await all<{ id: string; heading: string; text: string; embedding: ArrayBuffer | null }>(db, "SELECT id, heading, text, embedding FROM knowledge_chunks WHERE version_id = ? AND doc_id = ? ORDER BY ordinal LIMIT ?", versionId, docId, limit)
    : await all<{ id: string; heading: string; text: string; embedding: ArrayBuffer | null }>(db, "SELECT id, heading, text, embedding FROM knowledge_chunks WHERE version_id = ? ORDER BY doc_id, ordinal LIMIT ?", versionId, limit);
  return rows.map((r) => ({ id: r.id, heading: r.heading, text: r.text, embedded: Boolean(r.embedding) }));
}
