import { all, batch, one } from "../db";
import type { Env } from "../env";
import { badRequest, conflict, notFound } from "../lib/http";
import { newId } from "../lib/ids";
import { chunkDocument } from "./chunk";
import { embedTexts, vectorToBlob } from "./embed";
import { getVersion } from "./repo";

export type Correction = {
  id: string; company_id: string; source_version_id: string; doc_id: string | null;
  title: string; before_text: string; after_text: string; question: string;
  corrected_answer: string; status: string; published_version_id: string | null;
};

/** An exact, unique patch preserves all unrelated knowledge. */
export function applyCorrectionPatch(content: string, before: string, after: string): string {
  const start = content.indexOf(before);
  if (!before.trim() || !after.trim() || before === after || start < 0 || content.indexOf(before, start + 1) >= 0) {
    throw badRequest("The proposed source change is ambiguous or unchanged. Adjust the correction and preview again.");
  }
  return content.slice(0, start) + after + content.slice(start + before.length);
}

export async function publishCorrection(env: Env, companyId: string, correctionId: string, userId: string) {
  const correction = await one<Correction>(env.DB, "SELECT * FROM reply_corrections WHERE company_id = ? AND id = ?", companyId, correctionId);
  if (!correction) throw notFound("Correction not found.");
  if (correction.status === "published") return getVersion(env.DB, companyId, correction.published_version_id!);
  const base = await getVersion(env.DB, companyId, correction.source_version_id);
  if (base?.status !== "active") throw conflict("Knowledge changed. Preview the correction again.");
  const docs = await all<{ id: string; title: string; content: string; source_type: string }>(env.DB, "SELECT id, title, content, source_type FROM knowledge_docs WHERE company_id = ? AND version_id = ?", companyId, base.id);
  const target = correction.doc_id ? docs.find(doc => doc.id === correction.doc_id) : null;
  if (correction.doc_id && !target) throw conflict("The source document changed. Preview again.");
  const content = target ? applyCorrectionPatch(target.content, correction.before_text, correction.after_text) : correction.after_text;
  const changedChunks = chunkDocument(correction.title, content);
  const vectors = await embedTexts(env, changedChunks.map(chunk => `${chunk.heading}\n${chunk.text}`));
  if (!vectors) throw badRequest("Configure OpenAI embeddings before publishing a correction.");
  const versionId = `kv_${correction.id.slice(3)}`;
  const now = new Date().toISOString();
  const statements: Array<{ sql: string; params: Array<string | number | Uint8Array | null> }> = [
    { sql: "UPDATE reply_corrections SET status = 'published', published_version_id = ? WHERE company_id = ? AND id = ? AND status = 'proposed'", params: [versionId, companyId, correctionId] },
    { sql: "INSERT INTO knowledge_versions (id, company_id, number, title, status, created_by) SELECT ?, ?, COALESCE(MAX(number), 0) + 1, ?, 'draft', ? FROM knowledge_versions WHERE company_id = ?", params: [versionId, companyId, "Reply correction", userId, companyId] },
  ];
  const addChanged = (docId: string) => {
    statements.push({ sql: "INSERT INTO knowledge_docs (id, version_id, company_id, title, source_type, content, char_count) VALUES (?, ?, ?, ?, 'text', ?, ?)", params: [docId, versionId, companyId, correction.title, content, content.length] });
    changedChunks.forEach((chunk, index) => statements.push({ sql: "INSERT INTO knowledge_chunks (id, version_id, company_id, doc_id, ordinal, heading, text, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", params: [newId("kc"), versionId, companyId, docId, chunk.ordinal, chunk.heading, chunk.text, vectorToBlob(vectors[index])] }));
  };
  for (const doc of docs) {
    const docId = newId("kd");
    if (doc.id === correction.doc_id) { addChanged(docId); continue; }
    statements.push({ sql: "INSERT INTO knowledge_docs (id, version_id, company_id, title, source_type, content, char_count) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [docId, versionId, companyId, doc.title, doc.source_type, doc.content, doc.content.length] });
    const chunks = await all<{ ordinal: number; heading: string; text: string; embedding: ArrayBuffer | null }>(env.DB, "SELECT ordinal, heading, text, embedding FROM knowledge_chunks WHERE company_id = ? AND version_id = ? AND doc_id = ?", companyId, base.id, doc.id);
    chunks.forEach(chunk => statements.push({ sql: "INSERT INTO knowledge_chunks (id, version_id, company_id, doc_id, ordinal, heading, text, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", params: [newId("kc"), versionId, companyId, docId, chunk.ordinal, chunk.heading, chunk.text, chunk.embedding ? new Uint8Array(chunk.embedding) : null] }));
  }
  if (!target) addChanged(newId("kd"));
  statements.push(
    { sql: "UPDATE knowledge_versions SET chunk_count = (SELECT COUNT(*) FROM knowledge_chunks WHERE version_id = ?) WHERE id = ?", params: [versionId, versionId] },
    { sql: "INSERT INTO golden_tests (id, company_id, question, expected, created_by) VALUES (?, ?, ?, ?, ?)", params: [`gt_${correction.id.slice(3)}`, companyId, correction.question, correction.corrected_answer, userId] },
    { sql: "UPDATE knowledge_versions SET status = 'archived' WHERE company_id = ? AND status = 'active'", params: [companyId] },
    { sql: "UPDATE knowledge_versions SET status = 'active', activated_at = ? WHERE company_id = ? AND id = ?", params: [now, companyId, versionId] },
    { sql: "INSERT INTO events (id, company_id, type, detail_json) VALUES (?, ?, ?, ?)", params: [newId("evt"), companyId, "reply_correction_published", JSON.stringify({ correctionId, versionId, sourceVersionId: base.id, by: userId })] },
  );
  try { await batch(env.DB, statements); }
  catch (error) {
    const updated = await one<Correction>(env.DB, "SELECT * FROM reply_corrections WHERE company_id = ? AND id = ?", companyId, correctionId);
    if (updated?.status === "published") return getVersion(env.DB, companyId, updated.published_version_id!);
    const current = await getVersion(env.DB, companyId, base.id);
    if (current?.status !== "active") throw conflict("Knowledge changed. Preview the correction again.");
    throw error;
  }
  return getVersion(env.DB, companyId, versionId);
}
