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
    publication.value = null; review.value = null; error.value = ''; loading.value = !!props.companyId;
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
    saving.value = true; error.value = '';
    try {
        const result = operation === 'publish'
            ? await repository.publish(companyId, props.draftRevision, expectedRevision, reason.value.trim())
            : await repository.revert(companyId, expectedRevision, reason.value.trim());
        if (request !== sequence) return;
        publication.value = result; reason.value = ''; review.value = null;
        emit('changed');
    } catch (failure) {
        if (request !== sequence) return;
        review.value = null;
        error.value = failure?.code === 'revision_conflict'
            ? '다른 관리자가 게시 상태를 변경했습니다. 최신 상태를 다시 불러온 뒤 검토해 주세요.'
            : '권한을 적용하지 못했습니다. 권한과 인증 상태를 확인하고 게시 상태를 다시 불러와 주세요.';
    } finally {
        saving.value = false;
    }
}

watch(() => [props.companyId, props.draftRevision], (_next, previous) => {
    if (previous && previous[0] !== props.companyId) reason.value = '';
    load();
}, { immediate: true });
watch(() => props.dirty, () => { review.value = null; });
onBeforeUnmount(() => { sequence += 1; });
</script>

<template>
    <section class="access-editor" aria-label="권한 게시" :aria-busy="loading || saving">
        <h2>실제 권한 적용</h2>
        <p class="access-help">저장한 정책은 검토 후 적용해야 실제 권한에 반영됩니다.</p>
        <p v-if="loading" role="status">게시 상태를 불러오는 중입니다.</p>
        <p v-else-if="publication" role="status">
            {{ publication.active ? `적용 중인 버전 ${publication.revision}` : '아직 적용하지 않은 정책' }}
            · 적용된 초안 버전 {{ publication.draftRevision ?? '없음' }} · 저장된 초안 버전 {{ draftRevision }}
        </p>
        <p v-else-if="!companyId">회사를 선택해 주세요.</p>
        <div v-if="error" class="access-error" role="alert">
            <p>{{ error }}</p>
            <button type="button" data-test="reload" :disabled="loading || saving" @click="load">게시 상태 다시 불러오기</button>
        </div>
        <p v-if="dirty" class="access-help">변경한 초안을 먼저 저장해 주세요.</p>
        <label>적용 또는 복원 사유
            <textarea v-model="reason" rows="2" :disabled="saving" placeholder="변경 사유를 입력해 주세요" />
        </label>
        <div class="access-actions">
            <button type="button" data-test="review-publish" :disabled="!canPublish" @click="beginReview('publish')">저장한 권한 적용 검토</button>
            <button type="button" data-test="review-revert" :disabled="!canRevert" @click="beginReview('revert')">이전 게시 권한 복원 검토</button>
        </div>
        <div v-if="review" class="access-banner" role="region" aria-label="권한 변경 영향 검토">
            <p>이 변경은 실제 회사 사용자의 메뉴 접근과 회사·사업장 조회 및 변경 권한에 영향을 줍니다. 기술 관리자 복구 경로는 유지됩니다.</p>
            <p><strong>첫 권한 적용 시 전사 전환이 시작됩니다.</strong> 일반 사용자는 적용된 회사 정책에 유효하게 연결되어 있어야 업무에 접근할 수 있습니다. 아직 적용하지 않은 회사와 미연결 사용자는 접근이 제한되므로, 다른 회사와 사용자 연결도 먼저 검토해 주세요.</p>
            <p v-if="review === 'publish'">저장된 초안 버전 {{ draftRevision }}을 현재 게시 버전 {{ publication.revision }}에 적용합니다.</p>
            <p v-else>이전 게시 정책으로 복원합니다. 초안 저장 내용은 변경하지 않으며 권한 적용은 유지됩니다.</p>
            <div class="access-actions">
                <button class="primary" type="button" data-test="confirm" :disabled="review === 'publish' ? !canPublish : !canRevert" @click="confirm">{{ review === 'publish' ? '검토한 권한 적용' : '검토한 이전 권한 복원' }}</button>
                <button type="button" :disabled="saving" @click="review = null">취소</button>
            </div>
        </div>
    </section>
</template>
