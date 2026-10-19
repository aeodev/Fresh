/* global URL, Response, fetch, structuredClone */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { processAnalyses, redactAnalysisText, validateAnalysis } from '../worker/analysis/engine';
import { conversationRoutes } from '../worker/conversations/routes';
import { analysisRoutes } from '../worker/analysis/routes';
import { sha256Hex } from '../worker/lib/crypto';
vi.mock('../worker/conversations/object',()=>({conversationObjectId:()=>{throw new Error('Conversation sending is forbidden in analysis tests.');}}));
let sql, env, app, calls;
const result={outcome:'unclear',quality:'needs_improvement',summary:'The agent gave no next step.',findings:[{category:'guidance',messageId:'a',evidence:'Please wait.',issue:'No next step',suggestion:'Explain the next step and check understanding.'}]};
beforeEach(async()=>{
 sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const name of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
 const db={prepare(query){let args=[];const stmt={bind(...values){args=values;return stmt;},async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}};return stmt;}};
 env={DB:db,OPENAI_API_KEY:'test'};calls=0;
 sql.exec(`INSERT INTO users(id,email,name,password_hash) VALUES('u','u@local.test','Reviewer','none');
 INSERT INTO companies(id,slug,name,created_by) VALUES('c','test','Test','u'),('other','other','Other','u');
 INSERT INTO memberships(company_id,user_id,role) VALUES('c','u','owner');
 INSERT INTO conversations(company_id,id,freshchat_status) VALUES('c','chat','resolved'),('other','chat','resolved');
 INSERT INTO analysis_settings(company_id,enabled,daily_limit) VALUES('c',1,2),('other',1,2);
 INSERT INTO messages(id,company_id,conversation_id,actor_type,message_type,text,created_time) VALUES('q','c','chat','user','normal','Help please.','2026-10-15T00:00:00Z'),('a','c','chat','agent','normal','Please wait.','2026-10-15T00:01:00Z');
 UPDATE analysis_jobs SET due_at='2000-01-01T00:00:00Z';`);
 vi.stubGlobal('fetch',vi.fn(async()=>{calls++;return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}],usage:{total_tokens:100}}));}));
 const token='local-test-session';sql.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)').run(await sha256Hex(token),'u','2099-01-01T00:00:00Z');
 app=new Hono();app.route('/api/companies',analysisRoutes);app.route('/api/companies',conversationRoutes);app.onError((e,c)=>c.json({error:e.message},e.status??500));
});
afterEach(()=>{sql.close();vi.unstubAllGlobals();});
it('analyzes once, verifies evidence and never publishes knowledge or sends replies',async()=>{
 await processAnalyses(env);expect(calls).toBe(1);
 expect(sql.prepare('SELECT review_status FROM conversation_analyses').get().review_status).toBe('pending');
 expect(sql.prepare('SELECT count(*) n FROM analysis_jobs').get().n).toBe(0);
 expect(sql.prepare('SELECT count(*) n FROM knowledge_versions').get().n).toBe(0);
 expect(sql.prepare('SELECT count(*) n FROM turns').get().n).toBe(0);
 sql.exec(`INSERT INTO analysis_jobs(company_id,conversation_id,due_at) VALUES('c','chat','2000-01-01')`);
 await processAnalyses(env);expect(calls).toBe(1);
});
it('deduplicates concurrent runners using the lease',async()=>{await Promise.all([processAnalyses(env),processAnalyses(env)]);expect(calls).toBe(1);});
it('does not queue duplicate message updates, but queues actual edits',async()=>{
 sql.exec('DELETE FROM analysis_jobs');sql.exec(`UPDATE messages SET text=text WHERE id='a'`);expect(sql.prepare('SELECT count(*) n FROM analysis_jobs').get().n).toBe(0);
 sql.exec(`UPDATE messages SET text='I can guide you.' WHERE id='a'`);expect(sql.prepare('SELECT count(*) n FROM analysis_jobs').get().n).toBe(1);
});
it('pausing prevents work and new queuing',async()=>{sql.exec(`UPDATE analysis_settings SET enabled=0 WHERE company_id='c'`);await processAnalyses(env);expect(calls).toBe(0);sql.exec('DELETE FROM analysis_jobs');sql.exec(`UPDATE messages SET text='Changed' WHERE id='a'`);expect(sql.prepare('SELECT count(*) n FROM analysis_jobs').get().n).toBe(0);});
it('respects the daily company budget',async()=>{
 const day=new Date().toISOString().slice(0,10);sql.prepare('INSERT INTO analysis_usage VALUES(?,?,2)').run('c',day);
 await processAnalyses(env);expect(calls).toBe(0);expect(sql.prepare('SELECT count(*) n FROM analysis_jobs').get().n).toBe(1);
});
it('rejects fabricated evidence and retries at most three times',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify({...result,findings:[{...result.findings[0],evidence:'Invented quotation'}]})}]}]}))));
 sql.exec('UPDATE analysis_settings SET daily_limit=10');
 for(let i=0;i<4;i++){sql.exec(`UPDATE analysis_jobs SET due_at='2000-01-01'`);await processAnalyses(env);}
 expect(fetch).toHaveBeenCalledTimes(3);expect(sql.prepare('SELECT count(*) n FROM conversation_analyses').get().n).toBe(0);expect(sql.prepare('SELECT attempts FROM analysis_jobs').get().attempts).toBe(3);
});
it('excludes private notes and redacts common identifiers',async()=>{
 sql.exec(`INSERT INTO messages VALUES('private','c','chat','agent',NULL,'private','private secret','2026-10-15T00:02:00Z',NULL)`);
 await processAnalyses(env);expect(fetch.mock.calls[0][1].body).not.toContain('private secret');
 expect(redactAnalysisText('Email a@b.com password: secret https://site.test/token 12345678901')).not.toMatch(/a@b.com|secret|site.test|12345678901/);
});
const request=(path,body,method='POST')=>app.request(`/api/companies${path}`,{method,headers:{cookie:'fq_session=local-test-session','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},env,{waitUntil(){}});
it('requires authentication',async()=>{const r=await app.request('/api/companies/test/analysis',{},env);expect(r.status).toBe(401);});
it('company access and review are isolated',async()=>{
 await processAnalyses(env);const id=sql.prepare('SELECT id FROM conversation_analyses').get().id;
 expect((await request(`/other/analysis/${id}/review`,{status:'approved',note:'x'})).status).toBe(404);
 const r=await request(`/test/analysis/${id}/review`,{status:'approved',note:'Verified guidance.'});expect(r.status).toBe(200);
 expect(sql.prepare('SELECT review_status FROM conversation_analyses').get().review_status).toBe('approved');expect(sql.prepare('SELECT count(*) n FROM knowledge_versions').get().n).toBe(0);
});
it('viewers may read but cannot change settings or reviews',async()=>{
 sql.exec(`UPDATE memberships SET role='viewer'`);
 expect((await request('/test/analysis',null,'GET')).status).toBe(200);
 expect((await request('/test/analysis/settings',{enabled:true,dailyLimit:20},'PUT')).status).toBe(403);
 expect((await request('/test/analysis/any/review',{status:'approved',note:''})).status).toBe(403);
});
it('backlog queue caps at 50 local recent chats and does not pull Freshchat',async()=>{
 sql.exec('DELETE FROM analysis_jobs');
 const now=new Date().toISOString();
 for(let i=0;i<65;i++){
 sql.prepare(`INSERT INTO conversations(company_id,id,freshchat_status,updated_at) VALUES('c',?,'resolved',?)`).run(`batch-${i}`,now);
 sql.prepare(`INSERT INTO messages(id,company_id,conversation_id,actor_type,message_type,text,created_time) VALUES(?,'c',?,'agent','normal','Test reply',?)`).run(`msg-${i}`,`batch-${i}`,now);
 }
 sql.exec('DELETE FROM analysis_jobs');
 const r=await request('/test/analysis/queue',{});expect(r.status).toBe(200);expect((await r.json()).queued).toBe(50);expect(calls).toBe(0);
 const repeated=await request('/test/analysis/queue',{});expect((await repeated.json()).queued).toBe(16);
 expect(sql.prepare('SELECT count(*) n FROM analysis_jobs').get().n).toBe(66);
});
it('disabled-by-default company never queues history or messages',async()=>{
 sql.exec(`DELETE FROM analysis_settings WHERE company_id='other'; INSERT INTO messages VALUES('other-q','other','chat','user',NULL,'normal','Question','2026-10-15',NULL)`);
 expect(sql.prepare(`SELECT count(*) n FROM analysis_jobs WHERE company_id='other'`).get().n).toBe(0);
});
it('only owners and admins retry failed jobs, with tenant checks',async()=>{
 sql.exec(`UPDATE analysis_jobs SET attempts=3,error='temporary error'`);
 expect((await request('/other/analysis/jobs/chat/retry',{})).status).toBe(404);
 expect((await request('/test/analysis/jobs/chat/retry',{})).status).toBe(200);
 expect(sql.prepare(`SELECT attempts FROM analysis_jobs WHERE company_id='c'`).get().attempts).toBe(0);
});
it('keeps changed messages queued when they arrive during analysis',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{
 sql.exec(`UPDATE messages SET text='Please wait. I will check.' WHERE id='a'`);
 return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]}));
 }));
 await processAnalyses(env);expect(sql.prepare('SELECT count(*) n FROM analysis_jobs').get().n).toBe(1);expect(sql.prepare('SELECT lease_until FROM analysis_jobs').get().lease_until).toBeNull();
});
it('a paused company run endpoint does not perform analysis',async()=>{
 sql.exec(`UPDATE analysis_settings SET enabled=0 WHERE company_id='c'`);
 await processAnalyses(env,'c');expect(calls).toBe(0);
});

it('accepts harmless quote wrappers and punctuation but rejects invented evidence',()=>{
 const messages=[{id:'a',text:'I’m here. Let’s go slowly.'}];
 const value=structuredClone(result);value.findings[0].evidence='"I\'m here. Let\'s go slowly."';
 expect(validateAnalysis(value,messages).findings[0].evidence).toBe("I'm here. Let's go slowly.");
 value.findings[0].evidence='"I approved your refund."';expect(()=>validateAnalysis(value,messages)).toThrow('did not match');
});
it('source conversation returns the exact cited message and blocks other companies',async()=>{
 await processAnalyses(env);const saved=JSON.parse(sql.prepare('SELECT result_json FROM conversation_analyses').get().result_json);
 const response=await request('/test/conversations/chat',null,'GET');expect(response.status).toBe(200);
 const detail=await response.json();expect(detail.messages.find(m=>m.id===saved.findings[0].messageId).text).toContain(saved.findings[0].evidence);
 expect((await request('/other/conversations/chat',null,'GET')).status).toBe(404);
});
it('shows only the latest assessment without inheriting an older approval',async()=>{
 await processAnalyses(env);sql.exec("UPDATE conversation_analyses SET review_status='approved',created_at='2000-01-01'");
 const old=sql.prepare('SELECT * FROM conversation_analyses').get();
 sql.prepare(`INSERT INTO conversation_analyses(id,company_id,conversation_id,fingerprint,result_json,model,tokens,created_at) VALUES('new','c','chat','changed',?,'test',1,'2099-01-01')`).run(old.result_json);
 const data=await(await request('/test/analysis',null,'GET')).json();expect(data.rows).toHaveLength(1);expect(data.rows[0].id).toBe('new');expect(data.rows[0].review_status).toBe('pending');
});
it('manual runs can be capped to one model call',async()=>{
 sql.exec(`INSERT INTO conversations(company_id,id) VALUES('c','chat2');INSERT INTO messages(id,company_id,conversation_id,actor_type,message_type,text,created_time) VALUES('q2','c','chat2','user','normal','Help','2026-10-15'),('a2','c','chat2','agent','normal','Please wait.','2026-10-15');UPDATE analysis_jobs SET due_at='2000-01-01'`);
 await processAnalyses(env,'c',1);expect(calls).toBe(1);expect(sql.prepare('SELECT count(*) n FROM analysis_jobs').get().n).toBe(1);
});
