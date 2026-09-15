import { assertMasterRepository, createDefaultMasterRepository } from '@/repositories/master';
import { MASTER_ERROR_MESSAGES } from '@/repositories/master/errors';
import { computed, ref } from 'vue';

const byCode = (rows) => [...rows].sort((a, b) => a.code.localeCompare(b.code));
const replaceById = (rows, updated) => rows.map((row) => (row.id === updated.id ? { ...row, ...updated } : row));

export function createMasterStore({ repository = createDefaultMasterRepository() } = {}) {
    assertMasterRepository(repository);

    const companies = ref([]);
    const sites = ref([]);
    const partners = ref([]);
    const items = ref([]);
    const loading = ref(false);
    const loaded = ref(false);
    const error = ref(null);
    let loadPromise = null;
    let loadSequence = 0;

    const activeCompanies = computed(() => companies.value.filter((company) => company.isActive));
    const activeSites = computed(() => sites.value.filter((site) => site.isActive));
    const activePartners = computed(() => partners.value.filter((partner) => partner.isActive));
    const activeItems = computed(() => items.value.filter((item) => item.isActive));
    const siteCountByCompany = computed(() =>
        sites.value.reduce((counts, site) => {
            counts[site.companyId] = (counts[site.companyId] || 0) + 1;
            return counts;
        }, {})
    );

    const companyById = (id) => companies.value.find((company) => company.id === id) || null;
    const sitesFor = (companyId) => sites.value.filter((site) => site.companyId === companyId);
    const partnersFor = (companyId) => partners.value.filter((partner) => partner.companyId === companyId);
    const itemsFor = (companyId) => items.value.filter((item) => item.companyId === companyId);
    const itemById = (id) => items.value.find((item) => item.id === id) || null;

    async function load() {
        const sequence = ++loadSequence;
        loading.value = true;
        try {
            const [nextCompanies, nextSites, nextPartners, nextItems] = await Promise.all([repository.listCompanies(), repository.listSites(), repository.listPartners(), repository.listItems()]);
            if (sequence !== loadSequence) return;
            companies.value = byCode(nextCompanies);
            sites.value = byCode(nextSites);
            partners.value = byCode(nextPartners);
            items.value = byCode(nextItems);
            loaded.value = true;
            error.value = null;
        } catch {
            if (sequence === loadSequence) error.value = MASTER_ERROR_MESSAGES.master_load_failed;
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

    async function createCompany(draft) {
        const created = await repository.createCompany(draft);
        companies.value = byCode([...companies.value, created]);
        return created;
    }

    async function updateCompany(id, changes) {
        const updated = await repository.updateCompany(id, changes);
        companies.value = byCode(replaceById(companies.value, updated));

        if (changes?.isActive === false) {
            // The database cascades deactivation to sites; refresh them, or mirror it locally if the refresh fails.
            try {
                sites.value = byCode(await repository.listSites());
            } catch {
                sites.value = sites.value.map((site) => (site.companyId === id ? { ...site, isActive: false } : site));
            }
        }

        return updated;
    }

    async function createSite(draft) {
        const created = await repository.createSite(draft);
        sites.value = byCode([...sites.value, created]);
        return created;
    }

    async function updateSite(id, changes) {
        const updated = await repository.updateSite(id, changes);
        sites.value = byCode(replaceById(sites.value, updated));
        return updated;
    }

    async function createPartner(draft) {
        const created = await repository.createPartner(draft);
        partners.value = byCode([...partners.value, created]);
        return created;
    }

    async function updatePartner(id, changes) {
        const updated = await repository.updatePartner(id, changes);
        partners.value = byCode(replaceById(partners.value, updated));
        return updated;
    }

    async function createItem(draft) {
        const created = await repository.createItem(draft);
        items.value = byCode([...items.value, created]);
        return created;
    }

    async function updateItem(id, changes) {
        const updated = await repository.updateItem(id, changes);
        items.value = byCode(replaceById(items.value, updated));
        return updated;
    }

    return {
        companies,
        sites,
        partners,
        items,
        activeCompanies,
        activeSites,
        activePartners,
        activeItems,
        siteCountByCompany,
        loading,
        loaded,
        error,
        companyById,
        sitesFor,
        partnersFor,
        itemsFor,
        itemById,
        ensureLoaded,
        reload,
        createCompany,
        updateCompany,
        createSite,
        updateSite,
        createPartner,
        updatePartner,
        createItem,
        updateItem
    };
}

let browserStore;

export function useMasterStore() {
    if (!browserStore) browserStore = createMasterStore();
    return browserStore;
}
