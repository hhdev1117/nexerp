import { ref } from 'vue';
import { createEnterpriseRuntimeRepository, validateEnterpriseRuntimeContext } from '@/repositories/access/enterpriseRuntimeRepository';

export function createEnterpriseRuntimeStore({ repository = createEnterpriseRuntimeRepository() } = {}) {
    const context = ref(null);
    const loading = ref(false);
    const error = ref(null);
    const identityId = ref(null);
    let sequence = 0;
    let availableCompanies = [];
    const reset = () => {
        sequence += 1;
        context.value = null;
        loading.value = false;
        error.value = null;
        identityId.value = null;
        availableCompanies = [];
    };
    const refresh = async (identity, companyId = null) => {
        const request = ++sequence;
        if (identityId.value !== identity) availableCompanies = [];
        identityId.value = identity || null;
        context.value = null;
        error.value = null;
        loading.value = Boolean(identity);
        if (!identity) {
            availableCompanies = [];
            return null;
        }
        try {
            const next = validateEnterpriseRuntimeContext(await repository.loadContext(companyId));
            if (request !== sequence) return null;
            if (companyId !== null && next.companyId !== companyId) throw new Error('Invalid company selection');
            context.value = next;
            availableCompanies = next.companies.map(({ id }) => id);
            return next;
        } catch {
            if (request !== sequence) return null;
            context.value = null;
            availableCompanies = [];
            error.value = '권한 정보를 불러오지 못했습니다. 다시 시도해 주세요.';
            return null;
        } finally {
            if (request === sequence) loading.value = false;
        }
    };
    const selectCompany = async (identity, companyId) => {
        if (identity !== identityId.value || !availableCompanies.includes(companyId)) {
            reset();
            identityId.value = identity || null;
            error.value = '접근할 수 있는 회사를 선택해 주세요.';
            return null;
        }
        return refresh(identity, companyId);
    };
    const active = () => context.value?.mode === 'active' && !loading.value;
    return {
        context,
        loading,
        error,
        identityId,
        refresh,
        selectCompany,
        reset,
        canAccess: (menuKey) => Boolean(active() && context.value.menuKeys.includes(menuKey)),
        canCompanyAction: (action) => Boolean(active() && context.value.companyActions.includes(action)),
        canSiteAction: (id, action) => Boolean(active() && context.value.siteActions.some((site) => site.id === id && site.actions.includes(action)))
    };
}

let singleton;
export const useEnterpriseRuntimeStore = () => (singleton ??= createEnterpriseRuntimeStore());
