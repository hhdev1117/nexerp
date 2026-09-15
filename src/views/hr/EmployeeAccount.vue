<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { createHrAccountRepository } from '@/repositories/hr/hrAccountRepository';
const props = defineProps({ companyId: { type: String, required: true }, employeeId: { type: String, required: true } });
const emit = defineEmits(['changed']);
const auth = useAuthStore();
const repository = createHrAccountRepository();
const options = ref(null);
const history = ref([]);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const choice = ref('');
const reason = ref('');
const review = ref(null);
const mapped = { direct: '계정에 직접 지정', grade: '직급 매핑', position: '직책 매핑' };
const unmapped = { unlinked: '연결된 계정 없음', unmapped: '매핑된 권한 등급 없음', not_member: '회사 정책에 없는 계정', unpublished: '발행된 정책 없음' };
const levelText = (row) => (row === null || row === undefined ? '연결된 계정 없음' : mapped[row.source] ? `레벨 ${row.level} · ${mapped[row.source]}` : unmapped[row.source] || '확인 필요');
const linkedName = computed(() => options.value?.account?.name || '연결 없음');
const target = computed(() => options.value?.candidates.find((row) => row.id === choice.value) || null);
const candidateOptions = computed(() => [{ value: '', label: '연결 없음' }, ...(options.value?.candidates || []).map((row) => ({ value: row.id, label: row.name + ' · ' + levelText(row.preview), disabled: !options.value?.permissions.link }))]);
const canSubmit = computed(() => Boolean(options.value) && !loading.value && !saving.value && (choice.value ? options.value.permissions.link : options.value.permissions.unlink));
const time = (value) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
let sequence = 0;
function resetDraft() {
    choice.value = '';
    reason.value = '';
    review.value = null;
    notice.value = '';
}
async function load() {
    const request = ++sequence;
    options.value = null;
    history.value = [];
    error.value = '';
    if (!props.companyId || !props.employeeId || !auth.user.value?.id) return;
    loading.value = true;
    try {
        const [current, entries] = await Promise.all([repository.loadOptions(props.companyId, props.employeeId), repository.loadHistory(props.companyId, props.employeeId)]);
        if (request !== sequence) return;
        options.value = current;
        history.value = entries;
        choice.value = current.account?.id || '';
    } catch {
        if (request === sequence) error.value = '계정 연결 정보를 불러오지 못했습니다. 권한을 확인하고 다시 시도해 주세요.';
    } finally {
        if (request === sequence) loading.value = false;
    }
}
function prepare() {
    error.value = '';
    if (!options.value || saving.value || loading.value) return;
    if (choice.value === (options.value.account?.id || '')) {
        error.value = '현재 연결 상태와 같습니다. 다른 계정을 선택하거나 연결을 해제해 주세요.';
        return;
    }
    if (choice.value ? !options.value.permissions.link : !options.value.permissions.unlink) return;
    if (!reason.value.trim() || reason.value.trim().length > 2000) {
        error.value = '변경 사유를 1~2000자로 입력해 주세요.';
        return;
    }
    review.value = {
        revision: options.value.revision,
        beforeName: linkedName.value,
        beforePreview: options.value.account?.preview || null,
        afterId: choice.value || null,
        afterName: target.value?.name || '연결 없음',
        afterPreview: target.value?.preview || null,
        reason: reason.value.trim()
    };
}
async function submit() {
    if (!review.value || saving.value || loading.value) return;
    const change = { ...review.value };
    const identity = auth.user.value?.id;
    const companyId = props.companyId;
    const employeeId = props.employeeId;
    const request = ++sequence;
    saving.value = true;
    error.value = '';
    try {
        const result = await repository.linkAccount(companyId, employeeId, change.revision, change.afterId, change.reason);
        if (request !== sequence || auth.user.value?.id !== identity) return;
        options.value = result;
        choice.value = result.account?.id || '';
        const entries = await repository.loadHistory(companyId, employeeId).catch(() => null);
        if (request !== sequence) return;
        if (entries) history.value = entries;
        review.value = null;
        reason.value = '';
        notice.value = change.afterId ? '로그인 계정을 연결했습니다. 해당 계정의 권한은 다음 요청부터 적용됩니다.' : '로그인 계정 연결을 해제했습니다. 재직으로 부여되던 권한은 즉시 사라집니다.';
        emit('changed');
    } catch (cause) {
        if (request === sequence) {
            review.value = null;
            error.value = cause?.message || '계정 연결을 처리하지 못했습니다.';
        }
    } finally {
        if (request === sequence) saving.value = false;
    }
}
watch(
    () => [props.companyId, props.employeeId, auth.user.value?.id],
    () => {
        resetDraft();
        load();
    },
    { immediate: true, flush: 'sync' }
);
watch([choice, reason], () => {
    review.value = null;
});
onBeforeUnmount(() => {
    ++sequence;
});
</script>
<template>
    <section class="mt-8" aria-labelledby="account-link-title">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 id="account-link-title" class="text-lg font-semibold text-surface-900 dark:text-surface-0">로그인 계정 연결</h3>
            <Button data-testid="account-reload" label="다시 불러오기" icon="pi pi-refresh" size="small" severity="secondary" outlined :disabled="loading || saving" @click="load" />
        </div>

        <p v-if="loading" role="status" class="text-muted-color">계정 연결 정보를 불러오는 중입니다.</p>
        <Message v-if="error" severity="error" :closable="false" class="mb-4" role="alert">{{ error }}</Message>
        <Message v-if="notice" severity="success" :closable="false" class="mb-4" role="status">{{ notice }}</Message>

        <template v-if="options">
            <p data-testid="account-current" class="mt-0 mb-2">현재 연결 {{ linkedName }} · {{ levelText(options.account?.preview) }}</p>
            <Message v-if="options.account && !options.account.listed" data-testid="account-unlisted" severity="warn" :closable="false" class="mb-4">
                연결된 계정이 현재 발행된 회사 정책에 없거나 비활성 상태입니다. 이 계정은 회사 업무에 접근할 수 없으니 정책을 확인하거나 연결을 해제해 주세요.
            </Message>
            <Message v-if="options.status === 'terminated'" data-testid="account-terminated" severity="info" :closable="false" class="mb-4" role="status">퇴사한 직원입니다. 새 계정을 연결할 수 없으며 연결 해제만 가능합니다.</Message>
            <p class="mb-4 text-muted-color">직급 {{ options.grade || '미지정' }} · 직책 {{ options.position || '미지정' }} 기준으로 등급이 적용됩니다. 등급은 발행된 회사 정책에서만 결정됩니다.</p>

            <template v-if="options.permissions.link || options.permissions.unlink">
                <div class="flex flex-col gap-2 mb-4">
                    <label id="account-choice-label" for="account-choice" class="font-medium">연결할 계정</label>
                    <Select
                        inputId="account-choice"
                        v-model="choice"
                        :options="candidateOptions"
                        optionLabel="label"
                        optionValue="value"
                        :optionDisabled="(option) => option.disabled"
                        ariaLabelledby="account-choice-label"
                        :disabled="saving || loading"
                        fluid
                    />
                    <small v-if="!options.candidates.length" class="text-muted-color">연결할 수 있는 계정이 없습니다. 전사 권한관리에서 회사 구성원으로 먼저 등록해 주세요.</small>
                </div>
                <div class="flex flex-col gap-2 mb-4">
                    <label for="account-reason" class="font-medium">변경 사유</label>
                    <Textarea id="account-reason" v-model="reason" maxlength="2000" rows="2" placeholder="계정 연결을 변경하는 사유를 입력해 주세요" :disabled="saving || loading" fluid />
                </div>
                <Button data-testid="account-review" label="변경 내용 검토" icon="pi pi-eye" :disabled="!canSubmit" @click="prepare" />
            </template>
            <p v-else data-testid="account-readonly" class="text-muted-color">계정 연결을 변경할 권한이 없습니다.</p>

            <section v-if="review" data-testid="account-review-panel" class="p-5 mt-4 rounded-border bg-surface-50 dark:bg-surface-800">
                <h4 class="mb-3 text-base font-semibold">변경 내용 확인</h4>
                <p class="m-0">연결 계정: {{ review.beforeName }} → {{ review.afterName }}</p>
                <p class="mt-1 mb-0">권한 등급: {{ levelText(review.beforePreview) }} → {{ levelText(review.afterPreview) }}</p>
                <p class="mt-1 mb-0 text-muted-color">
                    {{
                        review.afterId
                            ? review.beforePreview
                                ? '이전 계정에 재직으로 부여되던 권한은 저장 즉시 사라집니다.'
                                : '선택한 계정에는 직원의 현재 직급·직책에 따른 권한 등급이 적용됩니다.'
                            : '연결 해제 후 이 직원의 재직 정보로 부여되던 권한이 사라집니다.'
                    }}
                </p>
                <p class="mt-1 mb-4 break-words">사유: {{ review.reason }}</p>
                <Button data-testid="account-save" label="확인하고 저장" icon="pi pi-check" :disabled="saving" @click="submit" />
            </section>

            <h4 class="mt-6 mb-3 text-base font-semibold">계정 연결 이력</h4>
            <p v-if="!history.length" class="text-muted-color">계정 연결 변경 이력이 없습니다.</p>
            <ol v-else class="p-0 m-0 list-none">
                <li v-for="item in history" :key="item.id" class="py-4 border-b border-surface-200 dark:border-surface-700 last:border-0">
                    <strong>{{ time(item.createdAt) }}</strong>
                    <p class="mt-2 mb-0">{{ item.beforeAccountId ? item.beforeAccountName : '연결 없음' }} → {{ item.afterAccountId ? item.afterAccountName : '연결 없음' }}</p>
                    <p class="mt-1 mb-0 text-muted-color break-words">{{ item.reason }}</p>
                </li>
            </ol>
        </template>
    </section>
</template>
