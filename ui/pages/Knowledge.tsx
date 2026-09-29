import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import type { GoldenTest, KnowledgeDoc, KnowledgeVersion } from "../../shared/types";
import { api, formatDate, formatShort } from "../api";
import { Alert, Chip, EmptyState, Icon, PageHead, Ring, Skeleton, useToast } from "../components/ui";
import { useCompany } from "./Company";

type State = { versions: KnowledgeVersion[]; active: { version: KnowledgeVersion; docs: KnowledgeDoc[] } | null; draft: { version: KnowledgeVersion; docs: KnowledgeDoc[] } | null };
type RunFn = (fn: () => Promise<unknown>, notice?: string) => Promise<void>;

export function Knowledge() {
  const { company, allowed, reload } = useCompany();
  const toast = useToast();
  const base = `/api/companies/${company.slug}`;
  const [state, setState] = useState<State | null>(null);
  const [tests, setTests] = useState<GoldenTest[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = allowed("knowledge.write");
  const canActivate = allowed("knowledge.activate");

  const load = useCallback(async () => {
    const [k, t] = await Promise.all([api<State>(`${base}/knowledge`), api<{ tests: GoldenTest[] }>(`${base}/agent/tests`)]);
    setState(k);
    setTests(t.tests);
    setSelected((cur) => (cur && k.versions.some((v) => v.id === cur) ? cur : (k.draft?.version.id ?? k.active?.version.id ?? k.versions[0]?.id ?? null)));
  }, [base]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    if (!selected) return setDocs(null);
    setDocs(null);
    api<{ docs: KnowledgeDoc[] }>(`${base}/knowledge/versions/${selected}`).then((r) => setDocs(r.docs)).catch(() => setDocs([]));
  }, [base, selected, state]);

  const run: RunFn = async (fn, notice) => {
    setBusy(true);
    try {
      await fn();
      await load();
      await reload();
      if (notice) toast.success(notice);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
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
        actions={canWrite && !draft ? <button className="primary" disabled={busy} onClick={() => void run(() => api(`${base}/knowledge/versions`, { body: {} }), "Draft created.")}><Icon name="plus" /> {active ? "New draft from active" : "Start first draft"}</button> : undefined}
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
            <VersionPanel base={base} version={version} docs={docs} canWrite={canWrite} canActivate={canActivate} busy={busy} run={run} />
          ) : (
            <div className="panel"><EmptyState icon="book" title="Add your first knowledge">Paste FAQs, policies, product info. Markdown headings become sections the agent can cite.</EmptyState></div>
          )}
          <GoldenTests base={base} tests={tests} versions={versions} canWrite={canWrite} busy={busy} run={run} />
        </div>
      </div>
    </>
  );
}

function VersionPanel({ base, version, docs, canWrite, canActivate, busy, run }: { base: string; version: KnowledgeVersion; docs: KnowledgeDoc[] | null; canWrite: boolean; canActivate: boolean; busy: boolean; run: RunFn }) {
  const [tab, setTab] = useState<"paste" | "upload" | "url">("paste");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editable = version.status === "draft" && canWrite;

  const addDoc = async (e: FormEvent) => {
    e.preventDefault();
    const body = tab === "url" ? { url: url.trim(), title: title.trim() } : { title: title.trim(), content, sourceType: tab === "upload" ? "file" : "text" };
    await run(() => api(`${base}/knowledge/versions/${version.id}/docs`, { body }), "Added and indexed.");
    setTitle("");
    setContent("");
    setUrl("");
  };
  const readFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result ?? ""));
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
          <p>{version.status === "active" ? "This is what the agent reads right now. Create a draft to change it." : version.status === "draft" ? "Add documents, test it in Test chat, then activate." : `Archived ${formatDate(version.createdAt)}. Restore it to make it live again.`}</p>
        </div>
        <div className="row">
          {version.status === "draft" && canActivate && version.chunkCount > 0 && <button className="green" disabled={busy} onClick={() => void run(() => api(`${base}/knowledge/versions/${version.id}/activate`, { body: {} }), `Version ${version.number} is live.`)}><Icon name="bolt" /> Activate</button>}
          {version.status === "archived" && canActivate && <button className="primary" disabled={busy} onClick={() => void run(() => api(`${base}/knowledge/versions/${version.id}/activate`, { body: {} }), `Restored version ${version.number}.`)}><Icon name="history" /> Restore</button>}
          {version.status !== "active" && canWrite && <button className="ghost" disabled={busy} onClick={() => { if (confirm(`Delete version ${version.number}?`)) void run(() => api(`${base}/knowledge/versions/${version.id}`, { method: "DELETE" }), "Deleted."); }}><Icon name="trash" /></button>}
        </div>
      </div>

      {docs === null ? <Skeleton lines={3} title={false} /> : docs.length === 0 ? <p className="mute" style={{ marginBottom: "1rem" }}>No documents in this version yet.</p> : (
        <div className="stack" style={{ gap: "0.6rem", marginBottom: editable ? "1.75rem" : 0 }}>
          {docs.map((d) => (
            <div key={d.id} className="doc">
              <span className="ico"><Icon name={d.sourceType === "url" ? "globe" : "file"} /></span>
              <div className="grow"><strong className="truncate" style={{ display: "block" }}>{d.title}</strong><span className="mute tiny">{d.sourceType} · {d.charCount.toLocaleString()} characters · added {formatDate(d.createdAt)}</span></div>
              {editable && <button className="ghost icon" disabled={busy} title="Remove" onClick={() => void run(() => api(`${base}/knowledge/versions/${version.id}/docs/${d.id}`, { method: "DELETE" }), "Removed.")}><Icon name="trash" size={16} /></button>}
            </div>
          ))}
        </div>
      )}

      {editable && (
        <form onSubmit={addDoc}>
          <div className="tabs" style={{ marginBottom: "1.25rem" }}>
            {(["paste", "upload", "url"] as const).map((t) => <button key={t} type="button" className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "paste" ? "Paste text" : t === "upload" ? "Upload file" : "Web page"}</button>)}
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
          {tab === "paste" && <div className="field"><label>Content</label><textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder={"# Delivery\n\nOrders ship within 2 business days…"} /><div className="hint">Markdown headings become sections the agent can cite.</div></div>}
          <div className="row end"><button className="primary" disabled={busy || !ready}>{busy ? "Indexing…" : <><Icon name="plus" /> Add document</>}</button></div>
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
    await run(() => api(`${base}/agent/tests`, { body: { question, expected } }), "Test added.");
    setQuestion("");
    setExpected("");
  };
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="row" style={{ gap: "1rem" }}>
          <Ring value={tests.length ? passed / tests.length : 0} label={tests.length ? `${passed}/${tests.length}` : "—"} />
          <div><h2>Golden tests</h2><p>Questions with the answer you expect. Run them before activating a draft or going live.</p></div>
        </div>
        {canWrite && tests.length > 0 && (
          <div className="row">
            <select value={versionId} onChange={(e) => setVersionId(e.target.value)} style={{ width: "auto" }}>
              <option value="">Active version</option>
              {versions.filter((v) => v.status !== "archived").map((v) => <option key={v.id} value={v.id}>v{v.number} {v.status}</option>)}
            </select>
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
