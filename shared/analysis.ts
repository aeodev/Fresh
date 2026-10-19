export type AnalysisResult = {
 outcome: 'resolved' | 'unresolved' | 'unclear';
 quality: 'good' | 'needs_improvement' | 'insufficient_evidence';
 summary: string;
 findings: Array<{ category: 'accuracy' | 'clarity' | 'empathy' | 'guidance' | 'handoff'; messageId: string; evidence: string; issue: string; suggestion: string }>;
};
export type AnalysisRow = {
 id: string; conversation_id: string; customer_name: string | null; result: AnalysisResult;
 model: string; tokens: number; review_status: 'pending' | 'approved' | 'rejected'; review_note: string;
 created_at: string; reviewer_id: string | null; reviewed_at: string | null;
};
export type AnalysisDashboard = {
 configured: boolean; jobs: Array<{ conversation_id: string; attempts: number; error: string | null; due_at: string }>;
 settings: { enabled: number; daily_limit: number }; usedToday: number; pending: number; failed: number;
 rows: AnalysisRow[];
};
