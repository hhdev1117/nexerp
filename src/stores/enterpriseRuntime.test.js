import { describe, expect, it } from 'vitest';
import { createEnterpriseRuntimeStore } from './enterpriseRuntime';

const ctx = (companyId = 'a') => ({
    mode: 'active',
    companyId,
    companies: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' }
    ],
    menuKeys: ['company'],
    companyActions: ['read'],
    siteActions: [{ id: 's', actions: ['read'] }],
    revision: 1
});
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
describe('enterprise runtime store', () => {
    it('clears cached grants immediately and fails closed on refresh failure', async () => {
        const pending = deferred();
        let calls = 0;
        const store = createEnterpriseRuntimeStore({ repository: { loadContext: () => (++calls === 1 ? ctx() : pending.promise) } });
        await store.refresh('u');
        expect(store.canAccess('company')).toBe(true);
        expect(store.canCompanyAction('read')).toBe(true);
        expect(store.canCompanyAction('update')).toBe(false);
        expect(store.canSiteAction('s', 'read')).toBe(true);
        expect(store.canSiteAction('other', 'read')).toBe(false);
        const refresh = store.refresh('u');
        expect(store.context.value).toBeNull();
        expect(store.canAccess('company')).toBe(false);
        expect(store.canCompanyAction('read')).toBe(false);
        expect(store.canSiteAction('s', 'read')).toBe(false);
        pending.reject(new Error('secret'));
        await refresh;
        expect(store.context.value).toBeNull();
        expect(store.error.value).toBeTruthy();
        expect(String(store.error.value)).not.toContain('secret');
    });
    it('ignores stale identity and reset responses', async () => {
        const first = deferred();
        const second = deferred();
        let calls = 0;
        const store = createEnterpriseRuntimeStore({ repository: { loadContext: () => (++calls === 1 ? first.promise : second.promise) } });
        const a = store.refresh('u1');
        const b = store.refresh('u2');
        second.resolve(ctx('b'));
        await b;
        first.resolve(ctx());
        await a;
        expect(store.context.value.companyId).toBe('b');
        expect(store.identityId.value).toBe('u2');
        const late = deferred();
        const resetStore = createEnterpriseRuntimeStore({ repository: { loadContext: () => late.promise } });
        const load = resetStore.refresh('u');
        resetStore.reset();
        late.resolve(ctx());
        await load;
        expect(resetStore.context.value).toBeNull();
    });
    it('rejects invalid selection and ignores stale company response', async () => {
        const a = deferred();
        const b = deferred();
        const store = createEnterpriseRuntimeStore({ repository: { loadContext: (id) => (id === 'a' ? a.promise : id === 'b' ? b.promise : ctx()) } });
        await store.refresh('u');
        const first = store.selectCompany('u', 'a');
        const second = store.selectCompany('u', 'b');
        b.resolve(ctx('b'));
        await second;
        a.resolve(ctx());
        await first;
        expect(store.context.value.companyId).toBe('b');
        await store.selectCompany('u', 'missing');
        expect(store.context.value).toBeNull();
        expect(store.error.value).toBeTruthy();
    });
    it('rejects malformed repository context and never grants legacy menu access', async () => {
        const store = createEnterpriseRuntimeStore({ repository: { loadContext: async () => ({ mode: 'active', menuKeys: ['company'] }) } });
        await store.refresh('u');
        expect(store.canAccess('company')).toBe(false);
        const legacy = createEnterpriseRuntimeStore({ repository: { loadContext: async () => ({ mode: 'legacy', companyId: null, companies: [], menuKeys: [], revision: 0 }) } });
        await legacy.refresh('u');
        expect(legacy.context.value.mode).toBe('legacy');
        expect(legacy.canAccess('company')).toBe(false);
    });
});
