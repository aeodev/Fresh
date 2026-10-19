import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { AnalysisDashboard, AnalysisRow } from '../../shared/analysis';
import { api, timeAgo } from '../api';
import { Alert, EmptyState } from '../components/ui';
import { useCompany } from './Company';

function Review({row,onReview,editable}:{row:AnalysisRow;onReview:(id:string,status:string,note:string)=>Promise<void>;editable:boolean}) {
 const [note,setNote]=useState(row.review_note);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [changing,setChanging]=useState(false);
 const submit=async(status:string)=>{setBusy(true);setError('');try{await onReview(row.id,status,note);setChanging(false);}catch(e){setError(e instanceof Error?e.message:'Review failed.');}finally{setBusy(false);}};
 return <div className="stack" style={{gap:10}}>
 {editable && (row.review_status==='pending'||changing) && <><details className="analysis-notes"><summary>Add reviewer notes</summary><label className="small">Notes<textarea maxLength={4000} value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional notes…" /></label></details>
 <div className="row"><button className="primary sm" disabled={busy} onClick={()=>void submit('approved')}>Approve</button><button className="ghost sm" disabled={busy} onClick={()=>void submit('rejected')}>Reject</button></div></>}
 {editable && row.review_status!=='pending'&&!changing&&<button className="ghost sm analysis-change" onClick={()=>setChanging(true)}>Change decision</button>}
 {error && <Alert tone="error">{error}</Alert>}
 <span className="small mute">{row.review_status==='pending'?'Awaiting review':`${row.review_status} · ${timeAgo(row.reviewed_at)}`}</span>
 </div>;
}
export function Analysis() {
 const {company,allowed}=useCompany();
 const [data,setData]=useState<AnalysisDashboard|null>(null);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const [filter,setFilter]=useState('all');
 const [limit,setLimit]=useState(20);
 const base=`/api/companies/${company.slug}/analysis`;
 const load=useCallback(async()=>{try{const d=await api<AnalysisDashboard>(base);setData(d);setError('');}catch(e){setError(e instanceof Error?e.message:'Could not load analysis.');}},[base]);
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),10000);return()=>clearInterval(timer);},[load]);
 const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();await load();}catch(e){setError(e instanceof Error?e.message:'Action failed.');}finally{setBusy(false);}};
 const review=async(id:string,status:string,note:string)=>{await api(`${base}/${id}/review`,{body:{status,note}});await load();};
 const rows=data?.rows.filter(r=>filter==='all'||(filter==='needs_improvement'?r.result.quality===filter:r.review_status===filter))??[];
 return <div className="analysis-page">
 <div className="analysis-heading"><div><h1>Conversation analysis</h1><p>Review what worked. Improve what didn’t.</p></div><span className="analysis-status">{data?.settings.enabled ? "● Running" : "○ Paused"}</span></div>
 {data&&!data.configured&&<Alert tone="info">Analysis needs an OpenAI connection.</Alert>}
 {error&&<Alert tone="error">{error}</Alert>}{notice&&<Alert tone="info">{notice}</Alert>}
 <details className="analysis-settings panel">
 <summary><span>Analysis settings</span><span className="small mute">{data?.usedToday??0}/{data?.settings.daily_limit??20} today · {data?.pending??0} queued</span></summary>
 <p className="small mute">New chats are reviewed automatically. Recent batches include up to 50 chats. Approvals don’t change live knowledge.</p>
 {allowed('agent.settings')&&<div className="row" style={{flexWrap:'wrap'}}>
 <label className="small">Daily limit <input aria-label="Daily analysis limit" type="number" min={1} max={100} value={limit} onChange={e=>setLimit(Number(e.target.value))} style={{width:85}} /></label>
 <button className="btn sm" disabled={busy||!data} onClick={()=>void action(async()=>{await api(`${base}/settings`,{method:'PUT',body:{enabled:!data?.settings.enabled,dailyLimit:limit}});setNotice(data?.settings.enabled?'Analysis paused.':'Analysis enabled.');})}>{data?.settings.enabled?'Pause analysis':'Enable analysis'}</button>
 <button className="btn sm" disabled={busy||!data?.settings.enabled} onClick={()=>void action(async()=>{await api(`${base}/settings`,{method:'PUT',body:{enabled:true,dailyLimit:limit}});setNotice('Daily limit saved.');})}>Save limit</button>
 <button className="btn sm" disabled={busy||!data?.settings.enabled} onClick={()=>void action(async()=>{const r=await api<{queued:number}>(`${base}/queue`,{body:{}});setNotice(`${r.queued} chats queued.`);})}>Analyze recent chats</button>
 <button className="btn sm" disabled={busy||!data?.settings.enabled||!data.configured||data.usedToday>=data.settings.daily_limit||data.pending===0} onClick={()=>void action(async()=>{await api(`${base}/run`,{body:{}});setNotice('Analysis started.');})}>Run now</button>
 </div>}
 </details>
 {data?.jobs.filter(j=>j.error).map(j=><div className="panel row" key={j.conversation_id} style={{marginBottom:12,flexWrap:'wrap'}}><span className="small">Conversation {j.conversation_id.slice(0,12)}: {j.error} · {j.attempts} attempts</span>{j.attempts>0&&allowed('agent.settings')&&<button className="btn sm" disabled={busy} onClick={()=>void action(async()=>{await api(`${base}/jobs/${encodeURIComponent(j.conversation_id)}/retry`,{body:{}});})}>Retry analysis</button>}</div>)}
 <div className="analysis-filters">{[['all','All'],['pending','To review'],['needs_improvement','Needs work'],['approved','Approved'],['rejected','Rejected']].map(([value,label])=><button key={value} className={filter===value?'primary sm':'ghost sm'} onClick={()=>setFilter(value)}>{label}</button>)}</div>
 {!data?<p>Loading analyses…</p>:!rows.length?<div className="panel"><EmptyState icon="sparkles" title="No reviews here yet">Reviews will appear as conversations are analyzed.</EmptyState></div>:rows.map(row=><article className="panel stack analysis-card" key={row.id} style={{gap:16,marginBottom:16}}>
 <div className="row" style={{justifyContent:'space-between',flexWrap:'wrap'}}><Link className="link" to={`/c/${company.slug}/conversations/${encodeURIComponent(row.conversation_id)}`}>{row.customer_name||`Conversation ${row.conversation_id.slice(0,12)}`}</Link><span className="small mute">{timeAgo(row.created_at)} · {({resolved:'Customer helped',unresolved:'Still needs help',unclear:'Outcome unclear'}[row.result.outcome])} · {({good:'Good support',needs_improvement:'Needs work',insufficient_evidence:'Not enough detail'}[row.result.quality])}</span></div>
 <p style={{margin:0}}>{row.result.summary}</p>
 <details className="analysis-details"><summary>{row.result.findings.length ? `${row.result.findings.length} suggested improvement${row.result.findings.length===1?"":"s"}` : "View assessment"}</summary>
 {row.result.findings.map((f,i)=><div key={i} className="analysis-finding"><strong>{f.issue}</strong><p>{f.suggestion}</p><blockquote>“{f.evidence}”</blockquote><Link className="link small" to={`/c/${company.slug}/conversations/${encodeURIComponent(row.conversation_id)}?message=${encodeURIComponent(f.messageId)}`}>View source conversation →</Link></div>)}
 {!row.result.findings.length&&<p className="small mute">No specific improvements identified in the available transcript.</p>}
 </details>
 <Review row={row} editable={allowed('knowledge.write')} onReview={review}/>
 <details className="analysis-meta"><summary>Review details</summary><span className="tiny mute">{row.model} · {row.tokens} tokens · {timeAgo(row.created_at)}</span></details>
 </article>)}
 </div>;
}
