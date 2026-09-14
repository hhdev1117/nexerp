import { ref } from 'vue';
import { createHrRepository, hrErrorMessage } from '@/repositories/hr/hrRepository';

export function createHrStore({ repository = createHrRepository() } = {}) {
    const directory = ref(null);
    const companyId = ref(null);
    const loading = ref(false);
    const saving = ref(false);
    const error = ref(null);
    let identity = 0;
    let loadVersion = 0;
    let search = '';
    let page = 1;

    const reset = () => {
        identity += 1;
        loadVersion += 1;
        directory.value = null;
        companyId.value = null;
        loading.value = false;
        saving.value = false;
        error.value = null;
        search = '';
        page = 1;
    };
    const load = async (company, query = '', requestedPage = 1) => {
        if (company !== companyId.value) reset();
        companyId.value = company || null;
        const version = ++loadVersion;
        search = query;
        page = requestedPage;
        directory.value = null;
        error.value = null;
        if (!company) return false;
        loading.value = true;
        try {
            const data = await repository.loadDirectory(company, query, requestedPage);
            if (version !== loadVersion) return false;
            directory.value = data;
            return true;
        } catch {
            if (version === loadVersion) error.value = '인사 정보를 불러오지 못했습니다. 권한을 확인하고 다시 시도해 주세요.';
            return false;
        } finally {
            if (version === loadVersion) loading.value = false;
        }
    };
    const mutate = async (method, permission, args) => {
        if (!companyId.value || saving.value || !directory.value?.permissions?.[permission]) return false;
        const generation = identity;
        const company = companyId.value;
        saving.value = true;
        error.value = null;
        try {
            await repository[method](company, ...args);
            if (generation !== identity) return false;
            await load(company, search, page);
            return generation === identity;
        } catch (cause) {
            if (generation === identity) error.value = hrErrorMessage(cause?.code);
            return false;
        } finally {
            if (generation === identity) saving.value = false;
        }
    };
    return {
        directory,
        companyId,
        loading,
        saving,
        error,
        load,
        reset,
        correctEmployee: (employeeId, revision, document, reason) => mutate('correctEmployee', 'update', [employeeId, revision, document, reason]),
        createEmployee: (document, reason) => mutate('createEmployee', 'create', [document, reason]),
        recordAction: (employeeId, revision, document) => mutate('recordAction', 'update', [employeeId, revision, document]),
        cancelAction: (employeeId, actionId, revision, reason) => mutate('cancelAction', 'cancel', [employeeId, actionId, revision, reason])
    };
}

let store;
export function useHrStore() {
    if (!store) store = createHrStore();
    return store;
}
