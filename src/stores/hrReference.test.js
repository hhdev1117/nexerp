import { describe, it, expect, vi } from 'vitest';
import { createHrReferenceStore } from './hrReference';
const deferred = () => {
    let resolve;
    const promise = new Promise((r) => {
        resolve = r;
    });
    return { promise, resolve };
};
const catalog = (code = 'A', canManage = true) => ({ items: [{ code }], canManage });
describe('HR reference store', () => {
    it('denies writes until loaded grants and clears grants on failed load', async () => {
        const repository = { loadReferences: vi.fn().mockResolvedValueOnce(catalog()).mockRejectedValueOnce(new Error('secret')), saveReference: vi.fn() };
        const store = createHrReferenceStore({ repository });
        expect(await store.save({}, 0, 'why')).toBe(false);
        await store.load('A');
        expect(store.catalog.value).toEqual([{ code: 'A' }]);
        await store.load('A');
        expect(store.catalog.value).toEqual([]);
        expect(store.canManage.value).toBe(false);
        expect(await store.save({}, 0, 'why')).toBe(false);
        expect(repository.saveReference).not.toHaveBeenCalled();
        expect(store.error.value).not.toContain('secret');
    });
    it('ignores previous identity responses, including same-company reopen', async () => {
        const pending = deferred();
        const repository = { loadReferences: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(catalog('B', false)) };
        const store = createHrReferenceStore({ repository });
        const old = store.load('A');
        store.reset();
        await store.load('A');
        pending.resolve(catalog('private'));
        expect(await old).toBe(false);
        expect(store.catalog.value).toEqual([{ code: 'B' }]);
        expect(store.canManage.value).toBe(false);
    });
    it('acknowledges save despite failed reload and denies duplicate writes', async () => {
        const pending = deferred();
        const repository = { loadReferences: vi.fn().mockResolvedValueOnce(catalog()).mockRejectedValueOnce(new Error('secret')), saveReference: vi.fn().mockReturnValue(pending.promise) };
        const store = createHrReferenceStore({ repository });
        await store.load('A');
        const save = store.save({ name: 'new' }, 1, 'rename');
        expect(await store.save({}, 1, 'duplicate')).toBe(false);
        pending.resolve('id');
        expect(await save).toBe(true);
        expect(repository.saveReference).toHaveBeenCalledWith('A', { name: 'new' }, 1, 'rename');
        expect(store.catalog.value).toEqual([]);
        expect(store.saving.value).toBe(false);
    });
    it('reset invalidates pending save and prevents its reload', async () => {
        const pending = deferred();
        const repository = { loadReferences: vi.fn().mockResolvedValue(catalog()), saveReference: () => pending.promise };
        const store = createHrReferenceStore({ repository });
        await store.load('A');
        const save = store.save({}, 1, 'why');
        store.reset();
        await store.load('B');
        pending.resolve('id');
        expect(await save).toBe(false);
        expect(repository.loadReferences).toHaveBeenCalledTimes(2);
    });
});
