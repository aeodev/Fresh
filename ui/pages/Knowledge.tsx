import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import type { GoldenTest, KnowledgeDoc, KnowledgeVersion } from "../../shared/types";
import { api, formatDate } from "../api";
import { Alert, Chip, EmptyState, Icon, PageHeader, Ring, Skeleton, useToast } from "../components/ui";
import { useCompany } from "./Company";

type Bundle = { version: KnowledgeVersion; docs: KnowledgeDoc[] } | null;
type State = { versions: KnowledgeVersion[]; active: Bundle; draft: Bundle };
type RunFn = (label: string, fn: () => Promise<unknown>, notice?: string) => Promise<void>;

export function Knowledge() {
  const { company, allowed, reload } = useCompany();
  const toast = useToast();
  const base = `/api/companies/${company.slug}`;
  const [state, setState] = useState<State | null>(null);
  const [tests, setTests] = useState<GoldenTest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canWrite = allowed("knowledge.write");
  const canActivate = allowed("knowledge.activate");

  const load = useCallback(async () => {
    const [k, t] = await Promise.all([api<State>(`${base}/knowledge`), api<{ tests: GoldenTest[] }>(`${base}/agent/tests`)]);
    setState(k);
    setTests(t.tests);
  }, [base]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const run: RunFn = async (label, fn, notice) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await load();
      await reload();
      if (notice) toast.success(notice);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  if (!state) return error ? <Alert tone="error">{error}</Alert> : <div className="card"><Skeleton lines={4} /></div>;
  const { active, draft, versions } = state;

  return (
    <>
      <PageHeader eyebrow="Knowledge" title="What the agent knows" subtitle="Versioned. Edit a draft, test it, activate it. The agent only ever reads the active version." />
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div className="row" style={{ gap: "0.8rem" }}>
              <span className="tile-ico tone-brand" style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center" }}><Icon name="layers" /></span>
              <div><h2>Active knowledge</h2><p>{active ? `v${active.version.number} · ${active.docs.length} doc${active.docs.length === 1 ? "" : "s"} · ${active.version.chunkCount} chunks · since ${formatDate(active.version.activatedAt)}` : "Nothing is live yet."}</p></div>
            </div>
            {active && <Chip tone="active" dot>Live</Chip>}
          </div>
          {!active ? <EmptyState icon="book" title="No active version">Build a draft on the right, then activate it.</EmptyState> : (
            <div className="doc-list">{active.docs.map((d) => <DocRow key={d.id} doc={d} />)}</div>
          )}
        </div>
        <DraftPanel base={base} draft={draft} hasActive={Boolean(active)} canWrite={canWrite} canActivate={canActivate} busy={busy} run={run} />
      </div>
      <GoldenTests base={base} tests={tests} versions={versions} canWrite={canWrite} busy={busy} run={run} />
      <div className="card flush">
        <div className="card-header"><div><h2>Versions</h2><p>Restore any archived version with one click.</p></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Version</th><th>Status</th><th>Docs</th><th>Chunks</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td><strong>v{v.number}</strong>{v.title ? <span className="muted"> · {v.title}</span> : ""}</td>
                  <td><Chip tone={v.status} dot={v.status === "active"}>{v.status}</Chip></td>
                  <td>{v.docCount}</td><td>{v.chunkCount}</td>
                  <td className="muted small">{formatDate(v.createdAt)}</td>
                  <td className="row end">
                    {v.status === "archived" && canActivate && <button className="small" disabled={busy !== null} onClick={() => void run("restore", () => api(`${base}/knowledge/versions/${v.id}/activate`, { body: {} }), `Restored v${v.number}.`)}><Icon name="history" /> Restore</button>}
                    {v.status === "archived" && canWrite && <button className="small ghost" disabled={busy !== null} onClick={() => void run("delete", () => api(`${base}/knowledge/versions/${v.id}`, { method: "DELETE" }))}><Icon name="trash" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function DocRow({ doc, onRemove, busy }: { doc: KnowledgeDoc; onRemove?: () => void; busy?: boolean }) {
  const icon = doc.sourceType === "url" ? "globe" : "file";
  return (
    <div className="doc">
      <span className={`ico ${doc.sourceType === "url" ? "tone-sky" : "tone-violet"}`}><Icon name={icon} /></span>
      <div className="grow"><strong className="truncate" style={{ display: "block" }}>{doc.title}</strong><span className="muted tiny">{doc.sourceType} · {doc.charCount.toLocaleString()} characters</span></div>
      {onRemove && <button className="small ghost" disabled={busy} onClick={onRemove} title="Remove"><Icon name="trash" /></button>}
    </div>
  );
}

function DraftPanel({ base, draft, hasActive, canWrite, canActivate, busy, run }: { base: string; draft: Bundle; hasActive: boolean; canWrite: boolean; canActivate: boolean; busy: string | null; run: RunFn }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const addDoc = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const body = url.trim() ? { url: url.trim(), title: title.trim() } : { title: title.trim(), content, sourceType: "text" };
    await run("add", () => api(`${base}/knowledge/versions/${draft.version.id}/docs`, { body }), "Document added and indexed.");
    setTitle("");
    setContent("");
    setUrl("");
  };
  const readFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result ?? ""));
      setUrl("");
      if (!title) setTitle(file.name.replace(/\.[a-z]+$/i, ""));
    };
    reader.readAsText(file);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    readFile(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="row" style={{ gap: "0.8rem" }}>
          <span className="tile-ico tone-amber" style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center" }}><Icon name="book" /></span>
          <div><h2>Draft</h2><p>{draft ? `v${draft.version.number} · ${draft.docs.length} doc${draft.docs.length === 1 ? "" : "s"} · ${draft.version.chunkCount} chunks` : "Edit a copy, test it, then activate."}</p></div>
        </div>
        {draft && <Chip tone="draft">Draft</Chip>}
      </div>
      {!draft ? (
        canWrite ? (
          <EmptyState icon="plus" title={hasActive ? "Start a new draft" : "Add your first knowledge"} action={
            <button className="primary" disabled={busy !== null} onClick={() => void run("draft", () => api(`${base}/knowledge/versions`, { body: {} }))}><Icon name="plus" /> {hasActive ? "New draft from active" : "Start first draft"}</button>
          }>{hasActive ? "It copies the active version so you never edit what is live." : "Paste FAQs, policies, product info. Markdown headings become sections."}</EmptyState>
        ) : <EmptyState icon="book" title="No draft in progress" />
      ) : (
        <>
          {draft.docs.length === 0 ? <p className="muted small" style={{ marginBottom: "0.8rem" }}>Empty draft. Add documents below.</p> : (
            <div className="doc-list" style={{ marginBottom: "1rem" }}>
              {draft.docs.map((d) => <DocRow key={d.id} doc={d} busy={busy !== null} onRemove={canWrite ? () => void run("remove", () => api(`${base}/knowledge/versions/${draft.version.id}/docs/${d.id}`, { method: "DELETE" })) : undefined} />)}
            </div>
          )}
          {canWrite && (
            <form onSubmit={addDoc}>
              <div className={`dropzone ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop} onClick={() => fileRef.current?.click()} role="button" tabIndex={0}>
                <Icon name="upload" /> <strong>Drop a .txt or .md file</strong> or click to choose
                <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.csv,.text" hidden onChange={(e) => readFile(e.target.files?.[0])} />
              </div>
              <div className="field" style={{ marginTop: "0.9rem" }}><label>Title</label><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shipping and returns" /></div>
              <div className="field"><label>Content</label><textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder={"# Delivery\n\nOrders ship within 2 business days…"} disabled={Boolean(url)} /></div>
              <div className="field"><label>Or import a web page</label><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://help.example.com/shipping" /><div className="hint">Public help-centre pages work best.</div></div>
              <div className="row">
                <button className="primary" disabled={busy !== null || (!url.trim() && (!title.trim() || content.trim().length < 20))}>{busy === "add" ? "Indexing…" : <><Icon name="plus" /> Add document</>}</button>
                {canActivate && draft.version.chunkCount > 0 && <button type="button" disabled={busy !== null} onClick={() => void run("activate", () => api(`${base}/knowledge/versions/${draft.version.id}/activate`, { body: {} }), `v${draft.version.number} is now live.`)}><Icon name="bolt" /> Activate draft</button>}
                <button type="button" className="ghost" disabled={busy !== null} onClick={() => { if (confirm("Discard this draft?")) void run("discard", () => api(`${base}/knowledge/versions/${draft.version.id}`, { method: "DELETE" })); }}>Discard</button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}

function GoldenTests({ base, tests, versions, canWrite, busy, run }: { base: string; tests: GoldenTest[]; versions: KnowledgeVersion[]; canWrite: boolean; busy: string | null; run: RunFn }) {
  const [question, setQuestion] = useState("");
  const [expected, setExpected] = useState("");
  const [versionId, setVersionId] = useState("");
  const passed = tests.filter((t) => t.lastResult === "pass").length;
  const add = async (e: FormEvent) => {
    e.preventDefault();
    await run("addtest", () => api(`${base}/agent/tests`, { body: { question, expected } }));
    setQuestion("");
    setExpected("");
  };
  return (
    <div className="card">
      <div className="card-header">
        <div className="row" style={{ gap: "0.9rem" }}>
          <Ring value={tests.length ? passed / tests.length : 0} label={tests.length ? `${passed}/${tests.length}` : "—"} />
          <div><h2>Golden tests</h2><p>Questions with the answer you expect. Run them before activating a draft or going live.</p></div>
        </div>
        {canWrite && tests.length > 0 && (
          <div className="row">
            <select value={versionId} onChange={(e) => setVersionId(e.target.value)} style={{ width: "auto" }}>
              <option value="">Active version</option>
              {versions.filter((v) => v.status !== "archived").map((v) => <option key={v.id} value={v.id}>v{v.number} {v.status}</option>)}
            </select>
            <button className="primary" disabled={busy !== null} onClick={() => void run("runtests", () => api(`${base}/agent/tests/run`, { body: { versionId: versionId || undefined } }), "Tests finished.")}><Icon name="play" /> {busy === "runtests" ? "Running…" : "Run tests"}</button>
          </div>
        )}
      </div>
      {tests.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: "0.9rem" }}>
          <table>
            <thead><tr><th>Question</th><th>Expected</th><th>Result</th><th></th></tr></thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.id}>
                  <td>{t.question}</td>
                  <td className="muted">{t.expected}</td>
                  <td>
                    {t.lastResult ? <Chip tone={t.lastResult} dot>{t.lastResult}</Chip> : <Chip>not run</Chip>}
                    {t.lastNote && <div className="muted tiny">{t.lastNote}</div>}
                    {t.lastAnswer && <details><summary className="tiny">Answer</summary><div className="small">{t.lastAnswer}</div></details>}
                  </td>
                  <td className="row end">{canWrite && <button className="small ghost" disabled={busy !== null} onClick={() => void run("deltest", () => api(`${base}/agent/tests/${t.id}`, { method: "DELETE" }))}><Icon name="trash" /></button>}</td>
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
          <button disabled={busy !== null || !question.trim() || !expected.trim()}><Icon name="plus" /> Add test</button>
        </form>
      )}
    </div>
  );
}
