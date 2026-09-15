<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { createEnterpriseRuntimeRepository } from '@/repositories/access/enterpriseRuntimeRepository';

const props = defineProps({ companyId: { type: String, default: '' }, draftRevision: { type: Number, default: 0 }, dirty: { type: Boolean, default: false } });
const emit = defineEmits(['changed']);
const repository = createEnterpriseRuntimeRepository();
const publication = ref(null);
const loading = ref(false);
const saving = ref(false);
const reason = ref('');
const error = ref('');
const review = ref(null);
let sequence = 0;
const ready = computed(() => !!props.companyId && !!publication.value && !loading.value && !saving.value && !error.value && !!reason.value.trim());
const canPublish = computed(() => ready.value && Number.isSafeInteger(props.draftRevision) && props.draftRevision > 0 && !props.dirty);
const canRevert = computed(() => ready.value && publication.value.active && publication.value.revision >= 2);

async function load() {
    const request = ++sequence;
    publication.value = null;
    review.value = null;
    error.value = '';
    loading.value = !!props.companyId;
    if (!props.companyId) return;
    try {
        const result = await repository.loadPublication(props.companyId);
        if (request === sequence) publication.value = result;
    } catch {
        if (request === sequence) error.value = '게시 상태를 불러오지 못했습니다. 다시 불러와 주세요.';
    } finally {
        if (request === sequence) loading.value = false;
    }
}

function beginReview(operation) {
    if (operation === 'publish' ? canPublish.value : canRevert.value) review.value = operation;
}

async function confirm() {
    const operation = review.value;
    if (operation === 'publish' ? !canPublish.value : operation !== 'revert' || !canRevert.value) return;
    const request = ++sequence;
    const companyId = props.companyId;
    const expectedRevision = publication.value.revision;
    saving.value = true;
    error.value = '';
    try {
        const result = operation === 'publish' ? await repository.publish(companyId, props.draftRevision, expectedRevision, reason.value.trim()) : await repository.revert(companyId, expectedRevision, reason.value.trim());
        if (request !== sequence) return;
        publication.value = result;
        reason.value = '';
        review.value = null;
        emit('changed');
    } catch (failure) {
        if (request !== sequence) return;
        review.value = null;
        error.value = failure?.code === 'revision_conflict' ? '다른 관리자가 게시 상태를 변경했습니다. 최신 상태를 다시 불러온 뒤 검토해 주세요.' : '권한을 적용하지 못했습니다. 권한과 인증 상태를 확인하고 게시 상태를 다시 불러와 주세요.';
    } finally {
        saving.value = false;
    }
}

watch(
    () => [props.companyId, props.draftRevision],
    (_next, previous) => {
        if (previous && previous[0] !== props.companyId) reason.value = '';
        load();
    },
    { immediate: true }
);
watch(
    () => props.dirty,
    () => {
        review.value = null;
    }
);
onBeforeUnmount(() => {
    sequence += 1;
});
</script>

<template>
    <section class="card" aria-label="권한 게시" :aria-busy="loading || saving">
        <h2 class="text-xl font-semibold text-surface-900 dark:text-surface-0">실제 권한 적용</h2>
        <p class="mt-1 mb-4 text-muted-color">저장한 정책은 검토 후 적용해야 실제 권한에 반영됩니다.</p>
        <p v-if="loading" role="status" class="text-muted-color">게시 상태를 불러오는 중입니다.</p>
        <p v-else-if="publication" role="status" class="mb-4">
            {{ publication.active ? `적용 중인 버전 ${publication.revision}` : '아직 적용하지 않은 정책' }}
            · 적용된 초안 버전 {{ publication.draftRevision ?? '없음' }} · 저장된 초안 버전 {{ draftRevision }}
        </p>
        <p v-else-if="!companyId" class="mb-4 text-muted-color">회사를 선택해 주세요.</p>
        <div v-if="error" role="alert" class="mb-4">
            <Message severity="error" :closable="false" class="mb-3">{{ error }}</Message>
            <Button type="button" data-test="reload" label="게시 상태 다시 불러오기" icon="pi pi-refresh" size="small" severity="secondary" outlined :disabled="loading || saving" @click="load" />
        </div>
        <Message v-if="dirty" severity="warn" :closable="false" class="mb-4">변경한 초안을 먼저 저장해 주세요.</Message>
        <div class="flex flex-col gap-2 mb-4">
            <label for="publication-reason" class="font-medium">적용 또는 복원 사유</label>
            <Textarea id="publication-reason" v-model="reason" rows="2" :disabled="saving" placeholder="변경 사유를 입력해 주세요" fluid />
        </div>
        <div class="flex flex-wrap gap-2">
            <Button type="button" data-test="review-publish" label="저장한 권한 적용 검토" icon="pi pi-send" :disabled="!canPublish" @click="beginReview('publish')" />
            <Button type="button" data-test="review-revert" label="이전 게시 권한 복원 검토" icon="pi pi-history" severity="secondary" outlined :disabled="!canRevert" @click="beginReview('revert')" />
        </div>
        <div v-if="review" role="region" aria-label="권한 변경 영향 검토" class="p-5 mt-4 border-l-4 rounded-border border-primary bg-surface-50 dark:bg-surface-800">
            <p class="mt-0">이 변경은 실제 회사 사용자의 메뉴 접근과 회사·사업장 조회 및 변경 권한에 영향을 줍니다. 기술 관리자 복구 경로는 유지됩니다.</p>
            <p>
                <strong>첫 권한 적용 시 전사 전환이 시작됩니다.</strong> 일반 사용자는 적용된 회사 정책에 유효하게 연결되어 있어야 업무에 접근할 수 있습니다. 아직 적용하지 않은 회사와 미연결 사용자는 접근이 제한되므로, 다른 회사와 사용자 연결도 먼저
                검토해 주세요.
            </p>
            <p v-if="review === 'publish'">저장된 초안 버전 {{ draftRevision }}을 현재 게시 버전 {{ publication.revision }}에 적용합니다.</p>
            <p v-else>이전 게시 정책으로 복원합니다. 초안 저장 내용은 변경하지 않으며 권한 적용은 유지됩니다.</p>
            <div class="flex flex-wrap gap-2 mt-4">
                <Button type="button" data-test="confirm" :label="review === 'publish' ? '검토한 권한 적용' : '검토한 이전 권한 복원'" icon="pi pi-check" :disabled="review === 'publish' ? !canPublish : !canRevert" @click="confirm" />
                <Button type="button" label="취소" severity="secondary" text :disabled="saving" @click="review = null" />
            </div>
        </div>
    </section>
</template>
