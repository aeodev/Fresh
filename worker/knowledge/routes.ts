import { router } from "../app";
import { requireUser } from "../auth/middleware";
import { withCompany } from "../companies/middleware";
import { logEvent } from "../events";
import { badRequest, notFound, readJson, str } from "../lib/http";
import { htmlToText, titleFromHtml } from "./html";
import {
  activateVersion,
  addDoc,
  createDraft,
  deleteDoc,
  deleteVersion,
  getActiveVersion,
  getDocContent,
  getDraftVersion,
  getVersion,
  listDocs,
  listVersions,
  previewChunks,
} from "./repo";

export const knowledgeRoutes = router();
knowledgeRoutes.use("*", requireUser);

knowledgeRoutes.get("/:slug/knowledge", withCompany("knowledge.read"), async (c) => {
  const companyId = c.get("company").id;
  const [versions, active, draft] = await Promise.all([listVersions(c.env.DB, companyId), getActiveVersion(c.env.DB, companyId), getDraftVersion(c.env.DB, companyId)]);
  return c.json({
    versions,
    active: active ? { version: active, docs: await listDocs(c.env.DB, active.id) } : null,
    draft: draft ? { version: draft, docs: await listDocs(c.env.DB, draft.id) } : null,
  });
});

/** Start a draft. With no body it copies the active version so you edit a copy, never the live one. */
knowledgeRoutes.post("/:slug/knowledge/versions", withCompany("knowledge.write"), async (c) => {
  const body = await readJson<{ title?: unknown; empty?: unknown }>(c).catch(() => ({}) as { title?: unknown; empty?: unknown });
  const companyId = c.get("company").id;
  if (await getDraftVersion(c.env.DB, companyId)) throw badRequest("There is already a draft. Edit it, activate it, or delete it first.");
  const active = body.empty ? null : await getActiveVersion(c.env.DB, companyId);
  const version = await createDraft(c.env.DB, companyId, c.get("user").id, active?.id ?? null, str(body.title, 80));
  await logEvent(c.env.DB, companyId, "knowledge_draft_created", { versionId: version.id, from: active?.id ?? null, by: c.get("user").email });
  return c.json({ version, docs: await listDocs(c.env.DB, version.id) }, 201);
});

knowledgeRoutes.get("/:slug/knowledge/versions/:id", withCompany("knowledge.read"), async (c) => {
  const version = await getVersion(c.env.DB, c.get("company").id, c.req.param("id"));
  if (!version) throw notFound("Version not found.");
  return c.json({ version, docs: await listDocs(c.env.DB, version.id) });
});

knowledgeRoutes.get("/:slug/knowledge/versions/:id/chunks", withCompany("knowledge.read"), async (c) => {
  const version = await getVersion(c.env.DB, c.get("company").id, c.req.param("id"));
  if (!version) throw notFound("Version not found.");
  return c.json({ chunks: await previewChunks(c.env.DB, version.id, c.req.query("docId") || null) });
});

knowledgeRoutes.get("/:slug/knowledge/versions/:id/docs/:docId", withCompany("knowledge.read"), async (c) => {
  const doc = await getDocContent(c.env.DB, c.req.param("id"), c.req.param("docId"));
  if (!doc) throw notFound("Document not found.");
  return c.json({ doc });
});

/** Add a document as pasted text, an uploaded file's text, or a URL to import. */
knowledgeRoutes.post("/:slug/knowledge/versions/:id/docs", withCompany("knowledge.write"), async (c) => {
  const companyId = c.get("company").id;
  const version = await getVersion(c.env.DB, companyId, c.req.param("id"));
  if (!version) throw notFound("Version not found.");
  if (version.status !== "draft") throw badRequest("Only a draft can be edited. Create a draft from this version first.");
  const body = await readJson<{ title?: unknown; content?: unknown; sourceType?: unknown; url?: unknown }>(c);
  let title = str(body.title, 120);
  let content = typeof body.content === "string" ? body.content.trim() : "";
  let sourceType = str(body.sourceType, 20) || "text";
  const url = str(body.url, 2000);
  if (url) {
    if (!/^https?:\/\//i.test(url)) throw badRequest("Enter a full http(s) URL.");
    const response = await fetch(url, { headers: { Accept: "text/html,text/plain,text/markdown" }, signal: AbortSignal.timeout(12_000), redirect: "follow" });
    if (!response.ok) throw badRequest(`That page returned HTTP ${response.status}.`);
    const raw = (await response.text()).slice(0, 2_000_000);
    const isHtml = (response.headers.get("content-type") ?? "").includes("html") || /<html/i.test(raw);
    content = isHtml ? htmlToText(raw) : raw.trim();
    title = title || (isHtml ? titleFromHtml(raw, url) : url);
    sourceType = "url";
  }
  if (!title) throw badRequest("Give the document a title.");
  if (content.length < 20) throw badRequest("The document is empty or too short to be useful.");
  if (content.length > 1_500_000) throw badRequest("That document is too large. Split it into smaller documents.");
  let result: Awaited<ReturnType<typeof addDoc>>;
  try {
    result = await addDoc(c.env, { companyId, versionId: version.id, title, content, sourceType });
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "Could not add the document.");
  }
  await logEvent(c.env.DB, companyId, "knowledge_doc_added", { versionId: version.id, title, chunks: result.chunkCount, embedded: result.embedded, by: c.get("user").email });
  return c.json({ ...result, docs: await listDocs(c.env.DB, version.id), version: await getVersion(c.env.DB, companyId, version.id) }, 201);
});

knowledgeRoutes.delete("/:slug/knowledge/versions/:id/docs/:docId", withCompany("knowledge.write"), async (c) => {
  const companyId = c.get("company").id;
  const version = await getVersion(c.env.DB, companyId, c.req.param("id"));
  if (!version) throw notFound("Version not found.");
  if (version.status !== "draft") throw badRequest("Only a draft can be edited.");
  await deleteDoc(c.env.DB, version.id, c.req.param("docId"));
  return c.json({ docs: await listDocs(c.env.DB, version.id), version: await getVersion(c.env.DB, companyId, version.id) });
});

knowledgeRoutes.delete("/:slug/knowledge/versions/:id", withCompany("knowledge.write"), async (c) => {
  const companyId = c.get("company").id;
  const version = await getVersion(c.env.DB, companyId, c.req.param("id"));
  if (!version) throw notFound("Version not found.");
  if (version.status === "active") throw badRequest("The active version cannot be deleted. Activate another version first.");
  await deleteVersion(c.env.DB, companyId, version.id);
  return c.json({ ok: true });
});

knowledgeRoutes.post("/:slug/knowledge/versions/:id/activate", withCompany("knowledge.activate"), async (c) => {
  const companyId = c.get("company").id;
  const version = await getVersion(c.env.DB, companyId, c.req.param("id"));
  if (!version) throw notFound("Version not found.");
  if (version.chunkCount === 0) throw badRequest("Add at least one document before activating.");
  await activateVersion(c.env.DB, companyId, version.id);
  await logEvent(c.env.DB, companyId, "knowledge_activated", { versionId: version.id, number: version.number, by: c.get("user").email });
  return c.json({ versions: await listVersions(c.env.DB, companyId) });
});
