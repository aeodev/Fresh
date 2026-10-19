import { Select } from "../components/Select";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import type { GoldenTest, KnowledgeDoc, KnowledgeVersion } from "../../shared/types";
import { hasSameText, splitForFormatting } from "../../shared/knowledge-format";
import { api, formatDate, formatShort } from "../api";
import { Alert, Chip, EmptyState, Icon, PageHead, Ring, Skeleton, useToast } from "../components/ui";
import { useCompany } from "./Company";

type State = { versions: KnowledgeVersion[]; active: { version: KnowledgeVersion; docs: KnowledgeDoc[] } | null; draft: { version: KnowledgeVersion; docs: KnowledgeDoc[] } | null };
type Changes = { added: string[]; updated: string[]; removed: string[]; unchanged: number; baseVersion: number | null };
type RunFn = (fn: () => Promise<unknown>, notice?: string, selectDraft?: boolean) => Promise<boolean>;

export function Knowledge() {
  const { company, allowed, reload } = useCompany();
  const toast = useToast();
  const base = `/api/companies/${company.slug}`;
  const [state, setState] = useState<State | null>(null);
  const [tests, setTests] = useState<GoldenTest[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [changes, setChanges] = useState<Changes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = allowed("knowledge.write");
  const canActivate = allowed("knowledge.activate");

  const load = useCallback(async () => {
    const [k, t] = await Promise.all([api<State>(`${base}/knowledge`), api<{ tests: GoldenTest[] }>(`${base}/agent/tests`)]);
    setState(k);
    setTests(t.tests);
    setSelected((cur) => (cur && k.versions.some((v) => v.id === cur) ? cur : (k.draft?.version.id ?? k.active?.version.id ?? k.versions[0]?.id ?? null)));
    return k;
  }, [base]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    if (!selected) return setDocs(null);
    setDocs(null);
    api<{ docs: KnowledgeDoc[]; changes: Changes }>(`${base}/knowledge/versions/${selected}`).then((r) => { setDocs(r.docs); setChanges(r.changes); }).catch(() => { setDocs([]); setChanges(null); });
  }, [base, selected, state]);

  const run: RunFn = async (fn, notice, selectDraft = false) => {
    setBusy(true);
    try {
      await fn();
      const refreshed = await load();
      if (selectDraft && refreshed.draft) setSelected(refreshed.draft.version.id);
      await reload();
      if (notice) toast.success(notice);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const version = useMemo(() => state?.versions.find((v) => v.id === selected) ?? null, [state, selected]);

  if (!state) return error ? <Alert tone="error">{error}</Alert> : <div className="panel"><Skeleton lines={4} /></div>;
  const { versions, draft, active } = state;

  return (
    <>
      <PageHead
        title={<>What the agent <em>knows</em>.</>}
        subtitle="Versioned, so nothing live changes by accident. Edit a draft, test it, activate it. Restore any version in one click."
        actions={canWrite && !draft ? <button className="primary" disabled={busy} onClick={() => void run(() => api(`${base}/knowledge/versions`, { body: {} }), "Draft created.", true)}><Icon name="plus" /> {active ? "New draft from active" : "Start first draft"}</button> : undefined}
      />
      <div className="kb">
        <aside>
          <div className="label" style={{ marginBottom: "0.75rem" }}>Versions</div>
          {versions.length === 0 && <div className="panel soft"><p className="mute small">No versions yet. Start a draft to add your first documents.</p></div>}
          {versions.map((v) => (
            <button key={v.id} type="button" className={`vcard ${selected === v.id ? "on" : ""}`} onClick={() => setSelected(v.id)}>
              <div className="t"><strong>Version {v.number}</strong><Chip tone={v.status} dot={v.status === "active"}>{v.status}</Chip></div>
              <div className="m"><span>{v.docCount} doc{v.docCount === 1 ? "" : "s"} · {v.chunkCount} chunks</span><span>{v.status === "active" ? `Live since ${formatShort(v.activatedAt)}` : v.status === "draft" ? `Started ${formatShort(v.createdAt)}` : `Archived · ${formatShort(v.createdAt)}`}</span></div>
            </button>
          ))}
        </aside>
        <div className="stack">
          {version ? (
            <VersionPanel key={version.id} base={base} version={version} docs={docs} changes={changes} draftExists={Boolean(draft)} canWrite={canWrite} canActivate={canActivate} busy={busy} run={run} />
          ) : (
            <div className="panel"><EmptyState icon="book" title="Add your first knowledge">Paste FAQs, policies, product info. Markdown headings become sections the agent can cite.</EmptyState></div>
          )}
          <GoldenTests base={base} tests={tests} versions={versions} canWrite={canWrite} busy={busy} run={run} />
        </div>
      </div>
    </>
  );
}

function VersionPanel({ base, version, docs, changes, draftExists, canWrite, canActivate, busy, run }: { base: string; version: KnowledgeVersion; docs: KnowledgeDoc[] | null; changes: Changes | null; draftExists: boolean; canWrite: boolean; canActivate: boolean; busy: boolean; run: RunFn }) {
  const [tab, setTab] = useState<"paste" | "upload" | "url">("paste");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const contentRef = useRef("");
  const [formatting, setFormatting] = useState(false);
  const [formatProgress, setFormatProgress] = useState<{ done: number; total: number } | null>(null);
  const [formatSuggestion, setFormatSuggestion] = useState<{ original: string; formatted: string } | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [formatNotice, setFormatNotice] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isDraft = version.status === "draft";
  const editable = canWrite && (isDraft || (version.status === "active" && !draftExists));

  const updateContent = (next: string) => {
    contentRef.current = next;
    setContent(next);
    setFormatSuggestion(null);
    setFormatError(null);
    setFormatNotice(null);
  };
  const tidy = async (original: string) => {
    if (formatting || original.trim().length < 30) return;
    setFormatting(true);
    setFormatError(null);
    setFormatNotice(null);
    const sections = splitForFormatting(original);
    setFormatProgress(sections.length > 1 ? { done: 0, total: sections.length } : null);
    try {
      const formattedSections: string[] = [];
      let recoveredSections = 0;
      let originalSections = 0;
      for (let start = 0; start < sections.length; start += 3) {
        const batch = sections.slice(start, start + 3);
        const results = await Promise.all(batch.map(async (section, offset) => {
          if (section.trim().length < 30) return { formatted: section, safeguard: "exact" as const };
          try {
            return await api<{ formatted: string; safeguard: "exact" | "recovered" | "original" }>(`${base}/knowledge/format`, { body: { content: section } });
          } catch (error) {
            throw new Error(`Section ${start + offset + 1}: ${error instanceof Error ? error.message : "Formatting is unavailable."}`, { cause: error });
          }
        }));
        formattedSections.push(...results.map((result) => result.formatted));
        recoveredSections += results.filter((result) => result.safeguard === "recovered").length;
        originalSections += results.filter((result) => result.safeguard === "original").length;
        if (sections.length > 1) setFormatProgress({ done: formattedSections.length, total: sections.length });
      }
      // A model may trim whitespace at a section edge; keep a separator between them.
      const formatted = formattedSections.join(" ");
      if (!hasSameText(original, formatted)) throw new Error("The suggestion changed an original character. Your paste was left untouched.");
      if (contentRef.current !== original) return; // the user kept editing while AI was working
      if (originalSections) setFormatNotice(`${originalSections} section${originalSections === 1 ? " was" : "s were"} kept unchanged because the AI changed too much text to recover safely.`);
      else if (recoveredSections) setFormatNotice(`The AI changed characters in ${recoveredSections} section${recoveredSections === 1 ? "" : "s"}; those characters were restored from your original before this preview.`);
      else if (formatted === original) setFormatNotice("No safe formatting changes were suggested.");
      if (formatted !== original) setFormatSuggestion({ original, formatted });
    } catch (error) {
      if (contentRef.current === original) setFormatError(error instanceof Error ? error.message : "Formatting is unavailable.");
    } finally {
      setFormatting(false);
      setFormatProgress(null);
    }
  };

  const addDoc = async (e: FormEvent) => {
    e.preventDefault();
    const body = tab === "url" ? { url: url.trim(), title: title.trim() } : { title: title.trim(), content, sourceType: tab === "upload" ? "file" : "text" };
    const saved = await run(() => editingId
      ? api(`${base}/knowledge/versions/${version.id}/docs/${editingId}`, { method: "PUT", body: { title: title.trim(), content } })
      : api(isDraft ? `${base}/knowledge/versions/${version.id}/docs` : `${base}/knowledge/docs`, { body }),
      editingId ? "Document updated in the working draft." : "Added to the working draft and indexed.", !isDraft);
    if (!saved) return;
    setEditingId(null);
    setTitle("");
    updateContent("");
    setUrl("");
  };
  const editDoc = async (doc: KnowledgeDoc) => {
    try {
      const result = await api<{ doc: { content: string; title: string } }>(`${base}/knowledge/versions/${version.id}/docs/${doc.id}`);
      setEditingId(doc.id);
      setTab("paste");
      setTitle(result.doc.title);
      updateContent(result.doc.content);
    } catch {
      setFormatError("Could not load this document for editing.");
    }
  };
  const readFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateContent(String(reader.result ?? ""));
      if (!title) setTitle(file.name.replace(/\.[a-z]+$/i, ""));
    };
    reader.readAsText(file);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    readFile(e.dataTransfer.files?.[0]);
  };
  const ready = tab === "url" ? Boolean(url.trim()) : title.trim().length > 0 && content.trim().length >= 20;

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="row"><h2 className="display" style={{ fontSize: "1.5rem" }}>Version {version.number}</h2><Chip tone={version.status} dot={version.status === "active"}>{version.status}</Chip></div>
          <p>{version.status === "active" ? "The agent reads this version. Adding knowledge starts a working draft automatically." : version.status === "draft" ? "Add documents, test it in Test chat, then activate." : `Archived ${formatDate(version.createdAt)}. Restore it to make it live again.`}</p>
        </div>
        <div className="row">
          {version.status === "draft" && canActivate && version.chunkCount > 0 && <button className="green" disabled={busy} onClick={() => void run(() => api(`${base}/knowledge/versions/${version.id}/activate`, { body: {} }), `Version ${version.number} is live.`)}><Icon name="bolt" /> Activate</button>}
          {version.status === "archived" && canActivate && <button className="primary" disabled={busy} onClick={() => void run(() => api(`${base}/knowledge/versions/${version.id}/activate`, { body: {} }), `Restored version ${version.number}.`)}><Icon name="history" /> Restore</button>}
          {version.status !== "active" && canWrite && <button className="ghost" disabled={busy} onClick={() => { if (confirm(`Delete version ${version.number}?`)) void run(() => api(`${base}/knowledge/versions/${version.id}`, { method: "DELETE" }), "Deleted."); }}><Icon name="trash" /></button>}
        </div>
      </div>

      {changes && <div className="version-changes">
        <strong>{changes.baseVersion === null ? "First version" : `Changes from version ${changes.baseVersion}`}</strong>
        {changes.added.length + changes.updated.length + changes.removed.length === 0 ? <span className="mute small">No changes yet. Add a document before publishing.</span> : (
          <div className="row"><span className="chip ok">+ {changes.added.length} added</span><span className="chip info">{changes.updated.length} updated</span><span className="chip warn">− {changes.removed.length} removed</span><span className="mute tiny">{changes.unchanged} unchanged</span></div>
        )}
        {[...changes.added.map((name) => `Added: ${name}`), ...changes.updated.map((name) => `Updated: ${name}`), ...changes.removed.map((name) => `Removed: ${name}`)].length > 0 && <details><summary className="link small">See document changes</summary><ul className="small">{changes.added.map((name) => <li key={`a-${name}`}>Added: {name}</li>)}{changes.updated.map((name) => <li key={`u-${name}`}>Updated: {name}</li>)}{changes.removed.map((name) => <li key={`r-${name}`}>Removed: {name}</li>)}</ul></details>}
      </div>}

      {docs === null ? <Skeleton lines={3} title={false} /> : docs.length === 0 ? <p className="mute" style={{ marginBottom: "1rem" }}>No documents in this version yet.</p> : (
        <div className="stack" style={{ gap: "0.6rem", marginBottom: editable ? "1.75rem" : 0 }}>
          {docs.map((d) => (
            <div key={d.id} className="doc">
              <span className="ico"><Icon name={d.sourceType === "url" ? "globe" : "file"} /></span>
              <div className="grow"><strong className="truncate" style={{ display: "block" }}>{d.title}</strong><span className="mute tiny">{d.sourceType} · {d.charCount.toLocaleString()} characters · added {formatDate(d.createdAt)}</span></div>
              {isDraft && editable && <button className="ghost sm" disabled={busy} onClick={() => void editDoc(d)}>Edit</button>}
              {isDraft && editable && <button className="ghost icon" disabled={busy} title="Remove" onClick={() => void run(() => api(`${base}/knowledge/versions/${version.id}/docs/${d.id}`, { method: "DELETE" }), "Removed.")}><Icon name="trash" size={16} /></button>}
            </div>
          ))}
        </div>
      )}

      {editable && (
        <form onSubmit={addDoc}>
          {editingId && <div className="row between" style={{ marginBottom: "1rem" }}><strong>Editing document</strong><button type="button" className="ghost sm" onClick={() => { setEditingId(null); setTitle(""); updateContent(""); }}>Cancel edit</button></div>}
          <div className="tabs" style={{ marginBottom: "1.25rem" }}>
            {(["paste", "upload", "url"] as const).filter((t) => (isDraft || t !== "url") && (!editingId || t === "paste")).map((t) => <button key={t} type="button" className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "paste" ? "Paste text" : t === "upload" ? "Upload file" : "Web page"}</button>)}
          </div>
          {tab === "upload" && (
            <div className={`dropzone ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop} onClick={() => fileRef.current?.click()} role="button" tabIndex={0} style={{ marginBottom: "1.25rem" }}>
              <Icon name="upload" /> <strong>Drop a .txt or .md file</strong> or click to choose
              <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.csv,.text" hidden onChange={(e) => readFile(e.target.files?.[0])} />
              {content && <div className="mute small" style={{ marginTop: 6 }}>{content.length.toLocaleString()} characters loaded</div>}
            </div>
          )}
          {tab === "url" && <div className="field"><label>Page URL</label><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://help.example.com/shipping" /><div className="hint">Public help-centre pages work best. The title is taken from the page unless you set one.</div></div>}
          <div className="field"><label>Title{tab === "url" ? " (optional)" : ""}</label><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shipping and returns" /></div>
          {tab === "paste" && <div className="field"><label>Content</label><textarea value={content} onChange={(e) => updateContent(e.target.value)} onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (!contentRef.current.trim() && pasted.length > 250 && (pasted.match(/\n/g) ?? []).length < 3) {
              // Dense clipboard text is offered a whitespace-only suggestion automatically.
              // The native paste still happens; the suggestion never replaces it until accepted.
              setTimeout(() => void tidy(contentRef.current), 0);
            }
          }} placeholder={"# Delivery\n\nOrders ship within 2 business days…"} /><div className="hint">Markdown headings become sections the agent can cite. Long pastes are formatted in sections automatically.</div></div>}
          {(tab === "paste" || tab === "upload") && content.trim().length >= 30 && <div className="row" style={{ marginBottom: "0.85rem" }}><button type="button" className="sm" disabled={formatting || busy} onClick={() => void tidy(content)}><Icon name="sparkles" size={16} /> {formatting ? "Tidying spacing…" : "Tidy formatting with AI"}</button><span className="mute tiny">Repairs broken letter spacing; every original character is checked.</span></div>}
          {formatProgress && <div className="mute small" role="status">Formatting {formatProgress.done} of {formatProgress.total} sections…</div>}
          {formatError && <Alert tone="warn">{formatError}</Alert>}
          {formatNotice && <Alert tone="info">{formatNotice}</Alert>}
          {formatSuggestion && <div className="format-preview" role="region" aria-label="Formatting suggestion">
            <div className="row between"><strong>Formatting preview</strong><span className="mute tiny">Only whitespace changed; every original character matches</span></div>
            <div className="format-preview-grid"><div><span className="label">Original</span><pre>{formatSuggestion.original}</pre></div><div><span className="label">Suggested</span><pre>{formatSuggestion.formatted}</pre></div></div>
            <div className="row end"><button type="button" className="ghost" onClick={() => setFormatSuggestion(null)}>Keep original</button><button type="button" className="primary" onClick={() => { updateContent(formatSuggestion.formatted); }}>Use suggested layout</button></div>
          </div>}
          <div className="row end"><button className="primary" disabled={busy || !ready}>{busy ? "Indexing…" : <>{!editingId && <Icon name="plus" />} {editingId ? "Save changes" : isDraft ? "Add document" : "Add to new draft"}</>}</button></div>
        </form>
      )}
    </div>
  );
}

function GoldenTests({ base, tests, versions, canWrite, busy, run }: { base: string; tests: GoldenTest[]; versions: KnowledgeVersion[]; canWrite: boolean; busy: boolean; run: RunFn }) {
  const [question, setQuestion] = useState("");
  const [expected, setExpected] = useState("");
  const [versionId, setVersionId] = useState("");
  const passed = tests.filter((t) => t.lastResult === "pass").length;
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!await run(() => api(`${base}/agent/tests`, { body: { question, expected } }), "Test added.")) return;
    setQuestion("");
    setExpected("");
  };
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="row" style={{ gap: "1rem" }}>
          <Ring value={tests.length ? passed / tests.length : 0} label={tests.length ? `${passed}/${tests.length}` : "0/0"} />
          <div><h2>Golden tests</h2><p>Questions with the answer you expect. Run them before activating a draft or going live.</p></div>
        </div>
        {canWrite && tests.length > 0 && (
          <div className="row">
            <Select label="Evaluation knowledge version" value={versionId} onValueChange={(value) => setVersionId(value)} style={{ width: "auto" }}>
              <option value="">Active version</option>
              {versions.filter((v) => v.status !== "archived").map((v) => <option key={v.id} value={v.id}>v{v.number} {v.status}</option>)}
            </Select>
            <button className="primary" disabled={busy} onClick={() => void run(() => api(`${base}/agent/tests/run`, { body: { versionId: versionId || undefined } }), "Tests finished.")}><Icon name="play" /> {busy ? "Running…" : "Run tests"}</button>
          </div>
        )}
      </div>
      {tests.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: "1rem" }}>
          <table>
            <thead><tr><th>Question</th><th>Expected</th><th>Result</th><th></th></tr></thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.id}>
                  <td>{t.question}</td>
                  <td className="mute">{t.expected}</td>
                  <td>
                    {t.lastResult ? <Chip tone={t.lastResult} dot>{t.lastResult}</Chip> : <Chip>not run</Chip>}
                    {t.lastNote && <div className="mute tiny" style={{ marginTop: 4 }}>{t.lastNote}</div>}
                    {t.lastAnswer && <details><summary className="link tiny">Answer</summary><div className="small">{t.lastAnswer}</div></details>}
                  </td>
                  <td className="row end">{canWrite && <button className="ghost icon" disabled={busy} onClick={() => void run(() => api(`${base}/agent/tests/${t.id}`, { method: "DELETE" }))}><Icon name="trash" size={16} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canWrite && (
        <form onSubmit={add} className="row" style={{ alignItems: "flex-end" }}>
          <div className="field grow" style={{ marginBottom: 0 }}><label>Customer question</label><input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Do you ship to Canada?" /></div>
          <div className="field grow" style={{ marginBottom: 0 }}><label>Expected answer</label><input type="text" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="Yes, 5–8 business days, $15 flat." /></div>
          <button disabled={busy || !question.trim() || !expected.trim()}><Icon name="plus" /> Add test</button>
        </form>
      )}
    </div>
  );
}
