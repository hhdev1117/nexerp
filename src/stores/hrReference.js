import { ref } from 'vue';
import { createHrRepository, hrErrorMessage } from '@/repositories/hr/hrRepository';

export function createHrReferenceStore({ repository = createHrRepository() } = {}) {
    const catalog = ref([]);
    const companyId = ref(null);
    const canManage = ref(false);
    const loading = ref(false);
    const saving = ref(false);
    const error = ref(null);
    let identity = 0;
    let loadVersion = 0;
    const reset = () => {
        identity += 1;
        loadVersion += 1;
        catalog.value = [];
        companyId.value = null;
        canManage.value = false;
        loading.value = false;
        saving.value = false;
        error.value = null;
    };
    const load = async (company) => {
        if (company !== companyId.value) reset();
        companyId.value = company || null;
        const version = ++loadVersion;
        catalog.value = [];
        canManage.value = false;
        error.value = null;
        if (!company) return false;
        loading.value = true;
        try {
            const data = await repository.loadReferences(company);
            if (version !== loadVersion) return false;
            catalog.value = data.items;
            canManage.value = data.canManage;
            return true;
        } catch {
            if (version === loadVersion) error.value = '인사 기준 정보를 불러오지 못했습니다. 권한을 확인하고 다시 시도해 주세요.';
            return false;
        } finally {
            if (version === loadVersion) loading.value = false;
        }
    };
    const save = async (document, revision, reason) => {
        if (!companyId.value || !canManage.value || saving.value) return false;
        const generation = identity;
        const company = companyId.value;
        saving.value = true;
        error.value = null;
        try {
            await repository.saveReference(company, document, revision, reason);
            if (generation !== identity) return false;
            await load(company);
            return generation === identity;
        } catch (cause) {
            if (generation === identity) error.value = hrErrorMessage(cause?.code);
            return false;
        } finally {
            if (generation === identity) saving.value = false;
        }
    };
    return { catalog, companyId, canManage, loading, saving, error, load, reset, save };
}
let store;
export function useHrReferenceStore() {
    if (!store) store = createHrReferenceStore();
    return store;
}
