import { router } from '../app';
import { requireUser } from '../auth/middleware';
import { withCompany } from '../companies/middleware';
import { all, one, run, today } from '../db';
import { logEvent } from '../events';
import { badRequest, notFound, readJson } from '../lib/http';
import { processAnalyses } from './engine';

export const analysisRoutes = router();
analysisRoutes.use('*',requireUser);
analysisRoutes.get('/:slug/analysis',withCompany('conversations.read'),async c=>{
 const id=c.get('company').id;
 const settings=await one(c.env.DB,'SELECT enabled,daily_limit FROM analysis_settings WHERE company_id=?',id) ?? {enabled:0,daily_limit:20};
 const counts=await one<{pending:number;failed:number}>(c.env.DB,`SELECT COUNT(CASE WHEN attempts<3 THEN 1 END) pending,COUNT(CASE WHEN attempts>=3 THEN 1 END) failed FROM analysis_jobs WHERE company_id=?`,id);
 const usage=await one<{requests:number}>(c.env.DB,'SELECT requests FROM analysis_usage WHERE company_id=? AND day=?',id,today());
 const rows=await all<{result_json:string}>(c.env.DB,`SELECT a.*,c.customer_name FROM conversation_analyses a JOIN conversations c ON c.company_id=a.company_id AND c.id=a.conversation_id WHERE a.company_id=? AND a.id=(SELECT latest.id FROM conversation_analyses latest WHERE latest.company_id=a.company_id AND latest.conversation_id=a.conversation_id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1) ORDER BY a.created_at DESC LIMIT 100`,id);
 const jobs=await all(c.env.DB,'SELECT conversation_id,attempts,error,due_at FROM analysis_jobs WHERE company_id=? ORDER BY due_at LIMIT 50',id);
 return c.json({configured:Boolean(c.env.OPENAI_API_KEY),jobs,settings,usedToday:usage?.requests??0,pending:counts?.pending??0,failed:counts?.failed??0,rows:rows.map(({result_json,...r})=>({...r,result:JSON.parse(result_json)}))});
});
analysisRoutes.put('/:slug/analysis/settings',withCompany('agent.settings'),async c=>{
 const b=await readJson<{enabled:unknown;dailyLimit:unknown}>(c);
 if(typeof b.enabled!=='boolean'||!Number.isInteger(b.dailyLimit)||Number(b.dailyLimit)<1||Number(b.dailyLimit)>100) throw badRequest('Choose a daily limit from 1 to 100.');
 await run(c.env.DB,'INSERT INTO analysis_settings(company_id,enabled,daily_limit) VALUES(?,?,?) ON CONFLICT(company_id) DO UPDATE SET enabled=excluded.enabled,daily_limit=excluded.daily_limit',c.get('company').id,b.enabled,Number(b.dailyLimit));
 await logEvent(c.env.DB,c.get('company').id,'analysis_settings_updated',{enabled:b.enabled,dailyLimit:b.dailyLimit,by:c.get('user').id});
 return c.json({ok:true});
});
analysisRoutes.post('/:slug/analysis/queue',withCompany('agent.settings'),async c=>{
 const id=c.get('company').id;
 const settings=await one<{enabled:number}>(c.env.DB,'SELECT enabled FROM analysis_settings WHERE company_id=?',id);
 if(!settings?.enabled) throw badRequest('Enable analysis first.');
 // Bounded local backlog only. Never pulls thousands of historical chats from Freshchat.
 const since=new Date(Date.now()-7*86400_000).toISOString();
 const result=await run(c.env.DB,`INSERT OR IGNORE INTO analysis_jobs(company_id,conversation_id,due_at)
 SELECT company_id,id,? FROM conversations c WHERE company_id=? AND updated_at>=?
 AND (freshchat_status='resolved' OR updated_at<?)
 AND EXISTS(SELECT 1 FROM messages m WHERE m.company_id=c.company_id AND m.conversation_id=c.id AND m.actor_type IN ('agent','bot') AND m.message_type='normal')
 AND NOT EXISTS(SELECT 1 FROM analysis_jobs j WHERE j.company_id=c.company_id AND j.conversation_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM conversation_analyses a WHERE a.company_id=c.company_id AND a.conversation_id=c.id AND a.created_at>=c.updated_at)
 ORDER BY needs_attention DESC,updated_at DESC LIMIT 50`,new Date().toISOString(),id,since,new Date(Date.now()-15*60_000).toISOString());
 await logEvent(c.env.DB,id,'analysis_recent_queued',{queued:result.meta.changes??0,by:c.get('user').id});
 return c.json({queued:result.meta.changes??0});
});
analysisRoutes.post('/:slug/analysis/run',withCompany('agent.settings'),async c=>{
 if(!c.env.OPENAI_API_KEY) throw badRequest('Connect OpenAI before starting a review.');
 const id=c.get('company').id;
 const settings=await one<{enabled:number;daily_limit:number}>(c.env.DB,'SELECT enabled,daily_limit FROM analysis_settings WHERE company_id=?',id);
 if(!settings?.enabled) throw badRequest('Enable analysis first.');
 const usage=await one<{requests:number}>(c.env.DB,'SELECT requests FROM analysis_usage WHERE company_id=? AND day=?',id,today());
 if((usage?.requests??0)>=settings.daily_limit) throw badRequest('Today’s analysis limit is reached. Increase the limit in settings or try tomorrow.');
 c.executionCtx.waitUntil(processAnalyses(c.env,c.get('company').id,1));
 return c.json({ok:true},202);
});
analysisRoutes.post('/:slug/analysis/jobs/:id/retry',withCompany('agent.settings'),async c=>{
 const result=await run(c.env.DB,'UPDATE analysis_jobs SET attempts=0,error=NULL,due_at=? WHERE company_id=? AND conversation_id=? AND attempts>0 AND lease_until IS NULL',new Date().toISOString(),c.get('company').id,c.req.param('id'));
 if(!result.meta.changes) throw notFound('Failed analysis job not found.');
 await logEvent(c.env.DB,c.get('company').id,'analysis_retry_requested',{conversationId:c.req.param('id'),by:c.get('user').id});
 return c.json({ok:true});
});
analysisRoutes.post('/:slug/analysis/:id/review',withCompany('knowledge.write'),async c=>{
 const b=await readJson<{status:unknown;note:unknown}>(c);
 if(!['approved','rejected'].includes(String(b.status))||typeof b.note!=='string'||b.note.length>4000) throw badRequest('Choose approve or reject and keep the note under 4000 characters.');
 const result=await run(c.env.DB,'UPDATE conversation_analyses SET review_status=?,review_note=?,reviewer_id=?,reviewed_at=? WHERE company_id=? AND id=?',String(b.status),b.note,c.get('user').id,new Date().toISOString(),c.get('company').id,c.req.param('id'));
 if(!result.meta.changes) throw notFound('Analysis not found.');
 await logEvent(c.env.DB,c.get('company').id,'analysis_reviewed',{analysisId:c.req.param('id'),status:b.status,by:c.get('user').id});
 return c.json({ok:true});
});
