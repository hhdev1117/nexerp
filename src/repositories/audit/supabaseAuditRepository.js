import { getSupabaseClient } from '@/lib/supabase/client';
import { AUDIT_PAGE_SIZE } from '@/data/audit';
import { AuditRepositoryError, auditError } from './errors';

const AUDIT_FIELDS = 'id, table_name, record_id, company_id, action, actor_id, changed_at, old_data, new_data';

const toEntry = (row) => ({
    id: row.id,
    tableName: row.table_name,
    recordId: row.record_id,
    companyId: row.company_id ?? null,
    action: row.action,
    actorId: row.actor_id ?? null,
    changedAt: row.changed_at ?? null,
    oldData: row.old_data ?? null,
    newData: row.new_data ?? null
});

// Row-level security already restricts the ledger to administrators; map the refusal to a clear code.
const failure = (source) => {
    if (source instanceof AuditRepositoryError) return source;
    const code = typeof source?.code === 'string' ? source.code : '';
    if (code === '42501' || code === 'PGRST301') return auditError('admin_required');
    return auditError('audit_load_failed');
};

export function createSupabaseAuditRepository(client = getSupabaseClient()) {
    return {
        async listAuditLogs(query = {}) {
            if (!client) throw auditError('audit_not_configured');

            const page = Number.isSafeInteger(query.page) && query.page > 0 ? query.page : 1;
            const first = (page - 1) * AUDIT_PAGE_SIZE;

            try {
                let request = client.from('audit_logs').select(AUDIT_FIELDS, { count: 'exact' });
                if (query.tableName) request = request.eq('table_name', query.tableName);
                if (query.action) request = request.eq('action', query.action);
                if (query.actorId) request = request.eq('actor_id', query.actorId);
                if (query.from) request = request.gte('changed_at', query.from);
                if (query.to) request = request.lte('changed_at', query.to);

                const { data, error, count } = await request.order('changed_at', { ascending: false }).order('id', { ascending: false }).range(first, first + AUDIT_PAGE_SIZE - 1);
                if (error) throw failure(error);

                const entries = Array.isArray(data) ? data.map(toEntry) : [];
                return { entries, total: Number.isFinite(count) ? count : entries.length, page, pageSize: AUDIT_PAGE_SIZE };
            } catch (error) {
                throw failure(error);
            }
        }
    };
}
