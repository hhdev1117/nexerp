import { getSupabaseClient } from '@/lib/supabase/client';

export class EnterpriseAccessRepositoryError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'EnterpriseAccessRepositoryError';
        this.code = code;
    }
}

const failure = (operation, error) => {
    const known = {
        40001: ['revision_conflict', '다른 관리자가 정책을 변경했습니다. 최신 정책을 다시 불러와 주세요.'],
        42501: ['access_denied', '활성 관리자 계정과 2단계 인증이 필요합니다.'],
        22023: ['invalid_policy', '정책의 사용자, 회사, 권한 또는 유효기간을 확인해 주세요.']
    };
    return new EnterpriseAccessRepositoryError(...(known[error?.code] || [`access_${operation}_failed`, '전사 권한 정책을 처리하지 못했습니다. 다시 시도해 주세요.']));
};

const normalizeDates = (policy) => {
    const copy = { ...policy };
    for (const key of ['members', 'mappings', 'overrides']) {
        if (Array.isArray(copy[key])) copy[key] = copy[key].map((item) => ({ ...item, from: item.from === '' ? null : item.from, to: item.to === '' ? null : item.to }));
    }
    return copy;
};

export function createEnterpriseAccessRepository(client = getSupabaseClient()) {
    const run = async (operation, query) => {
        if (!client) throw new EnterpriseAccessRepositoryError('access_not_configured', 'Supabase 연결 정보가 설정되지 않았습니다.');
        try {
            const { data, error } = await query();
            if (error) throw error;
            const row = Array.isArray(data) ? data[0] : data;
            if (!row && operation === 'load') return { policy: null, revision: 0 };
            if (!row?.policy || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('Invalid policy response');
            return { policy: row.policy, revision: row.revision };
        } catch (error) {
            throw failure(operation, error);
        }
    };
    return {
        load: (companyId) => run('load', () => client.from('enterprise_access_policies').select('policy, revision').eq('company_id', companyId).maybeSingle()),
        save: (companyId, policy, revision, reason) => run('save', () => client.rpc('enterprise_save_access_policy', { target_company: companyId, policy_document: normalizeDates(policy), expected_revision: revision, change_reason: reason }))
    };
}
