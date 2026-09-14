// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import AccessPublication from './AccessPublication.vue';
const repository = vi.hoisted(() => ({ loadPublication: vi.fn(), publish: vi.fn(), revert: vi.fn() }));
vi.mock('@/repositories/access/enterpriseRuntimeRepository', () => ({ createEnterpriseRuntimeRepository: () => repository }));
beforeEach(() => {
    vi.clearAllMocks();
    repository.loadPublication.mockResolvedValue({ active: true, revision: 2, draftRevision: 3 });
    repository.publish.mockResolvedValue({ active: true, revision: 3, draftRevision: 4 });
    repository.revert.mockResolvedValue({ active: true, revision: 3, draftRevision: 2 });
});
const setup = async (props = {}) => { const wrapper = mount(AccessPublication, { props: { companyId: 'a', draftRevision: 4, dirty: false, ...props } }); await flushPromises(); return wrapper; };
it('requires reason and explicit review before publishing exact saved revision', async () => {
    const wrapper = await setup();
    expect(wrapper.find('[data-test="confirm"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="review-publish"]').element.disabled).toBe(true);
    await wrapper.get('textarea').setValue('  조직 개편  ');
    await wrapper.get('[data-test="review-publish"]').trigger('click');
    expect(repository.publish).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('실제 회사 사용자');
    await wrapper.get('[data-test="confirm"]').trigger('click'); await flushPromises();
    expect(repository.publish).toHaveBeenCalledWith('a', 4, 2, '조직 개편');
    expect(wrapper.emitted('changed')).toHaveLength(1);
});
it.each([{ dirty: true }, { draftRevision: 0 }])('does not publish unsaved policy %j', async (props) => {
    const wrapper = await setup(props); await wrapper.get('textarea').setValue('reason');
    expect(wrapper.get('[data-test="review-publish"]').element.disabled).toBe(true);
    expect(repository.publish).not.toHaveBeenCalled();
});
it('preserves reason and requires reload on conflict without retry', async () => {
    repository.publish.mockRejectedValue({ code: 'revision_conflict', message: 'secret' });
    const wrapper = await setup(); await wrapper.get('textarea').setValue('reason');
    await wrapper.get('[data-test="review-publish"]').trigger('click'); await wrapper.get('[data-test="confirm"]').trigger('click'); await flushPromises();
    expect(wrapper.get('textarea').element.value).toBe('reason');
    expect(wrapper.text()).not.toContain('secret');
    expect(wrapper.get('[data-test="review-publish"]').element.disabled).toBe(true);
    await wrapper.get('[data-test="reload"]').trigger('click'); await flushPromises();
    expect(repository.publish).toHaveBeenCalledTimes(1); expect(wrapper.emitted('changed')).toBeUndefined();
});
it('reverts only after explicit review with optimistic revision', async () => {
    const wrapper = await setup(); await wrapper.get('textarea').setValue('복원');
    await wrapper.get('[data-test="review-revert"]').trigger('click');
    expect(repository.revert).not.toHaveBeenCalled();
    await wrapper.get('[data-test="confirm"]').trigger('click'); await flushPromises();
    expect(repository.revert).toHaveBeenCalledWith('a', 2, '복원');
    expect(wrapper.emitted('changed')).toHaveLength(1);
});
it('discards late company load and clears review on draft changes', async () => {
    let resolve;
    repository.loadPublication.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const wrapper = mount(AccessPublication, { props: { companyId: 'a', draftRevision: 4, dirty: false } });
    await wrapper.setProps({ companyId: 'b' }); await flushPromises();
    resolve({ active: true, revision: 99, draftRevision: 99 }); await flushPromises();
    expect(wrapper.text()).not.toContain('99');
    await wrapper.get('textarea').setValue('reason'); await wrapper.get('[data-test="review-publish"]').trigger('click');
    await wrapper.setProps({ draftRevision: 5 }); await flushPromises();
    expect(wrapper.find('[data-test="confirm"]').exists()).toBe(false);
});
