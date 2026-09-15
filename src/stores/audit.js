import { AUDIT_PAGE_SIZE, auditQuery, createAuditFilter } from '@/data/audit';
import { assertAuditRepository, createDefaultAuditRepository } from '@/repositories/audit';
import { AUDIT_ERROR_MESSAGES } from '@/repositories/audit/errors';
import { computed, ref } from 'vue';

export function createAuditStore({ repository = createDefaultAuditRepository() } = {}) {
    assertAuditRepository(repository);

    const entries = ref([]);
    const total = ref(0);
    const page = ref(1);
    const filter = ref(createAuditFilter());
    const loading = ref(false);
    const loaded = ref(false);
    const error = ref(null);
    let loadPromise = null;
    let loadSequence = 0;

    const pageCount = computed(() => Math.max(1, Math.ceil(total.value / AUDIT_PAGE_SIZE)));
    const hasFilters = computed(() => {
        const query = auditQuery(filter.value);
        return Boolean(query.tableName || query.actorId || query.action || query.from || query.to);
    });

    // Only the newest request may write to the store, so fast filter changes cannot arrive out of order.
    async function load() {
        const sequence = ++loadSequence;
        loading.value = true;
        try {
            const result = await repository.listAuditLogs(auditQuery(filter.value));
            if (sequence !== loadSequence) return;
            entries.value = Array.isArray(result?.entries) ? result.entries : [];
            total.value = Number.isFinite(result?.total) ? result.total : entries.value.length;
            page.value = Number.isSafeInteger(result?.page) && result.page > 0 ? result.page : 1;
            loaded.value = true;
            error.value = null;
        } catch (cause) {
            if (sequence !== loadSequence) return;
            entries.value = [];
            total.value = 0;
            error.value = AUDIT_ERROR_MESSAGES[cause?.code] || AUDIT_ERROR_MESSAGES.audit_load_failed;
        } finally {
            if (sequence === loadSequence) loading.value = false;
        }
    }

    const ensureLoaded = () => {
        if (!loadPromise) loadPromise = load();
        return loadPromise;
    };

    const reload = () => {
        loadPromise = load();
        return loadPromise;
    };

    // Any filter change restarts at the first page; otherwise a narrow filter can land on an empty page.
    function applyFilter(changes) {
        filter.value = { ...filter.value, ...changes, page: 1 };
        return reload();
    }

    function resetFilter() {
        filter.value = createAuditFilter();
        return reload();
    }

    function goToPage(next) {
        const target = Number.isSafeInteger(next) && next > 0 ? Math.min(next, pageCount.value) : 1;
        if (target === filter.value.page) return loadPromise ?? reload();
        filter.value = { ...filter.value, page: target };
        return reload();
    }

    return { entries, total, page, pageCount, filter, hasFilters, loading, loaded, error, ensureLoaded, reload, applyFilter, resetFilter, goToPage };
}

let browserStore;

export function useAuditStore() {
    if (!browserStore) browserStore = createAuditStore();
    return browserStore;
}
