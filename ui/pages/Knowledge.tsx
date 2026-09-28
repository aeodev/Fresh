import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { GoldenTest, KnowledgeDoc, KnowledgeVersion } from "../../shared/types";
import { api, formatDate } from "../api";
import { useCompany } from "./Company";

type Bundle = { version: KnowledgeVersion; docs: KnowledgeDoc[] } | null;
type State = { versions: KnowledgeVersion[]; active: Bundle; draft: Bundle };

export function Knowledge() {
  const { company, allowed, reload } = useCompany();
  const base = `/api/companies/${company.slug}`;
  const [state, setState] = useState<State | null>(null);
  const [tests, setTests] = useState<GoldenTest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  const run = async (label: string, fn: () => Promise<unknown>, successNotice?: string) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await load();
      await reload();
      if (successNotice) setNotice(successNotice);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  if (!state) return error ? <div className="alert error">{error}</div> : <p className="muted">Loading…</p>;
  const { active, draft, versions } = state;

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert info">{notice}</div>}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div><h2>Active knowledge</h2><p className="muted small">What the agent answers from right now.</p></div>
            {active && <span className="pill active">v{active.version.number}</span>}
          </div>
          {!active ? <p className="empty">No active version yet. Build a draft and activate it.</p> : (
            <>
              <p className="small muted">{active.docs.length} document{active.docs.length === 1 ? "" : "s"} · {active.version.chunkCount} chunks · activated {formatDate(active.version.activatedAt)}</p>
              <ul className="small">{active.docs.map((d) => <li key={d.id}>{d.title} <span className="muted">({d.charCount.toLocaleString()} chars)</span></li>)}</ul>
            </>
          )}
        </div>
        <DraftPanel base={base} draft={draft} hasActive={Boolean(active)} canWrite={canWrite} canActivate={canActivate} busy={busy} run={run} />
      </div>
      <GoldenTests base={base} tests={tests} versions={versions} canWrite={canWrite} busy={busy} run={run} />
      <div className="card">
        <h2>Versions</h2>
        <table>
          <thead><tr><th>Version</th><th>Status</th><th>Docs</th><th>Chunks</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td>v{v.number}{v.title ? ` · ${v.title}` : ""}</td>
                <td><span className={`pill ${v.status}`}>{v.status}</span></td>
                <td>{v.docCount}</td><td>{v.chunkCount}</td>
                <td className="muted small">{formatDate(v.createdAt)}</td>
                <td className="row end">
                  {v.status === "archived" && canActivate && <button className="small" disabled={busy !== null} onClick={() => void run("restore", () => api(`${base}/knowledge/versions/${v.id}/activate`, { body: {} }), `Restored v${v.number}.`)}>Restore</button>}
                  {v.status === "archived" && canWrite && <button className="small danger" disabled={busy !== null} onClick={() => void run("delete", () => api(`${base}/knowledge/versions/${v.id}`, { method: "DELETE" }))}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

type RunFn = (label: string, fn: () => Promise<unknown>, notice?: string) => Promise<void>;

function DraftPanel({ base, draft, hasActive, canWrite, canActivate, busy, run }: { base: string; draft: Bundle; hasActive: boolean; canWrite: boolean; canActivate: boolean; busy: string | null; run: RunFn }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
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

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result ?? ""));
      if (!title) setTitle(file.name.replace(/\.[a-z]+$/i, ""));
    };
    reader.readAsText(file);
  };

  return (
    <div className="card">
      <div className="card-header">
        <div><h2>Draft</h2><p className="muted small">Edit a copy, test it, then activate.</p></div>
        {draft && <span className="pill draft">v{draft.version.number}</span>}
      </div>
      {!draft ? (
        canWrite ? (
          <button className="primary" disabled={busy !== null} onClick={() => void run("draft", () => api(`${base}/knowledge/versions`, { body: {} }))}>
            {hasActive ? "New draft from active" : "Start first draft"}
          </button>
        ) : <p className="empty">No draft in progress.</p>
      ) : (
        <>
          {draft.docs.length === 0 ? <p className="empty">Empty draft. Add documents below.</p> : (
            <table>
              <tbody>
                {draft.docs.map((d) => (
                  <tr key={d.id}>
                    <td>{d.title}<div className="muted small">{d.sourceType} · {d.charCount.toLocaleString()} chars</div></td>
                    <td className="row end">{canWrite && <button className="small danger" disabled={busy !== null} onClick={() => void run("remove", () => api(`${base}/knowledge/versions/${draft.version.id}/docs/${d.id}`, { method: "DELETE" }))}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canWrite && (
            <form onSubmit={addDoc} style={{ marginTop: "1rem" }}>
              <div className="field"><label>Title</label><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shipping and returns" /></div>
              <div className="field">
                <label>Content</label>
                <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste FAQ text, policies, product info… Markdown headings become sections." disabled={Boolean(url)} />
                <div className="row" style={{ marginTop: 6 }}>
                  <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.csv,.text" onChange={(e) => onFile(e.target.files?.[0])} style={{ width: "auto" }} />
                </div>
              </div>
              <div className="field"><label>Or import a page</label><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://help.example.com/shipping" /><div className="hint">Public help-centre pages work best.</div></div>
              <div className="row">
                <button className="primary" disabled={busy !== null || (!url.trim() && (!title.trim() || content.trim().length < 20))}>{busy === "add" ? "Indexing…" : "Add document"}</button>
                {canActivate && draft.version.chunkCount > 0 && <button disabled={busy !== null} onClick={(e) => { e.preventDefault(); void run("activate", () => api(`${base}/knowledge/versions/${draft.version.id}/activate`, { body: {} }), `v${draft.version.number} is now active.`); }}>Activate draft</button>}
                <button className="danger" disabled={busy !== null} onClick={(e) => { e.preventDefault(); if (confirm("Discard this draft?")) void run("discard", () => api(`${base}/knowledge/versions/${draft.version.id}`, { method: "DELETE" })); }}>Discard</button>
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
        <div><h2>Golden tests</h2><p className="muted small">Questions with the answer you expect. Run them before activating a draft or going live.</p></div>
        <div className="row">
          {tests.length > 0 && <span className={`pill ${passed === tests.length ? "pass" : "warn"}`}>{passed}/{tests.length} passing</span>}
          {canWrite && tests.length > 0 && (
            <>
              <select value={versionId} onChange={(e) => setVersionId(e.target.value)} style={{ width: "auto" }}>
                <option value="">Active version</option>
                {versions.filter((v) => v.status !== "archived").map((v) => <option key={v.id} value={v.id}>v{v.number} {v.status}</option>)}
              </select>
              <button className="primary" disabled={busy !== null} onClick={() => void run("runtests", () => api(`${base}/agent/tests/run`, { body: { versionId: versionId || undefined } }), "Tests finished.")}>{busy === "runtests" ? "Running…" : "Run tests"}</button>
            </>
          )}
        </div>
      </div>
      {tests.length > 0 && (
        <table>
          <thead><tr><th>Question</th><th>Expected</th><th>Result</th><th></th></tr></thead>
          <tbody>
            {tests.map((t) => (
              <tr key={t.id}>
                <td>{t.question}</td>
                <td className="muted">{t.expected}</td>
                <td>
                  {t.lastResult ? <span className={`pill ${t.lastResult}`}>{t.lastResult}</span> : <span className="pill">not run</span>}
                  {t.lastNote && <div className="muted small">{t.lastNote}</div>}
                  {t.lastAnswer && <details><summary className="small">Answer</summary><div className="small">{t.lastAnswer}</div></details>}
                </td>
                <td className="row end">{canWrite && <button className="small danger" disabled={busy !== null} onClick={() => void run("deltest", () => api(`${base}/agent/tests/${t.id}`, { method: "DELETE" }))}>Delete</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canWrite && (
        <form onSubmit={add} className="row" style={{ marginTop: "0.75rem", alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Customer question</label><input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Do you ship to Canada?" /></div>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Expected answer</label><input type="text" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="Yes, 5–8 business days, $15 flat." /></div>
          <button disabled={busy !== null || !question.trim() || !expected.trim()}>Add test</button>
        </form>
      )}
    </div>
  );
}
