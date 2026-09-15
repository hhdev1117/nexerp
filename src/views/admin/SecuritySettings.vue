<script setup>
import { computed, onMounted, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
const confirm = useConfirm();
const code = ref('');
const manualKeyVisible = ref(false);
const message = ref('');

const enrollment = computed(() => authStore.mfaEnrollment.value);
const factors = computed(() => authStore.mfaFactors.value || []);
const busy = computed(() => authStore.loading.value);
const hasMfaError = computed(() => authStore.mfaStatus.value === 'error');
const cleanupPending = computed(() => Boolean(enrollment.value?.cleanupPending));
const validCode = computed(() => /^\d{6}$/.test(code.value));
const qrSource = computed(() => {
    const qrCode = enrollment.value?.qrCode || '';
    return qrCode.startsWith('<svg') ? `data:image/svg+xml,${encodeURIComponent(qrCode)}` : qrCode;
});

const clearEnrollmentEntry = () => {
    code.value = '';
    manualKeyVisible.value = false;
};

const refresh = async () => {
    message.value = '';
    try {
        await authStore.refreshMfaState();
    } catch {
        message.value = '인증 앱 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
};

const begin = async () => {
    message.value = '';
    clearEnrollmentEntry();
    try {
        await authStore.beginTotpEnrollment();
    } catch {
        message.value = '인증 앱을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
};

const verify = async () => {
    message.value = '';
    if (!validCode.value) {
        message.value = '인증 앱의 6자리 숫자 코드를 입력해 주세요.';
        return;
    }
    try {
        const result = await authStore.verifyTotpEnrollment(code.value);
        if (result?.status !== 'ready') {
            message.value = '인증 상태를 확인하지 못했습니다. 다시 시도해 주세요.';
            return;
        }
        clearEnrollmentEntry();
    } catch {
        message.value = '인증 코드를 확인하지 못했습니다. 다시 입력해 주세요.';
    }
};

const cancel = async () => {
    message.value = '';
    try {
        await authStore.cancelTotpEnrollment();
        clearEnrollmentEntry();
    } catch {
        message.value = '인증 앱 등록을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
};

const retryCleanup = async () => {
    message.value = '';
    try {
        const result = await authStore.cancelTotpEnrollment();
        clearEnrollmentEntry();
        if (!result?.status) {
            message.value = '인증 앱 등록 상태를 확인하지 못했습니다. 다시 시도해 주세요.';
            return;
        }
        await refresh();
    } catch {
        message.value = '인증 앱 등록을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
};

const remove = (factor) => {
    confirm.require({
        message: '이 인증 앱을 삭제하시겠습니까?',
        header: '인증 앱 삭제',
        acceptLabel: '삭제',
        rejectLabel: '취소',
        accept: async () => {
            try {
                await authStore.unenrollTotp(factor.id);
            } catch {
                message.value = '인증 앱을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.';
            }
        }
    });
};

onMounted(refresh);
</script>

<template>
    <div class="min-w-0" aria-labelledby="security-title">
        <ConfirmDialog />
        <div class="mb-6">
            <h1 id="security-title" class="text-2xl font-semibold text-surface-900 dark:text-surface-0">인증 앱 관리</h1>
            <div class="mt-1 text-muted-color">백업 인증 앱을 추가해 계정 복구를 준비하세요.</div>
        </div>

        <Message v-if="message" severity="error" :closable="false" class="mb-6" role="alert">{{ message }}</Message>

        <section v-if="cleanupPending" class="card" aria-labelledby="cleanup-title">
            <h2 id="cleanup-title" class="mt-0 mb-1 text-lg font-semibold">등록 정리</h2>
            <p class="mt-0 mb-4 text-muted-color">이전 인증 앱 등록을 정리한 후 다시 시도해 주세요.</p>
            <Button label="등록 정리 다시 시도" icon="pi pi-refresh" :loading="busy" :disabled="busy" @click="retryCleanup" />
        </section>

        <section v-else-if="hasMfaError" class="card" aria-labelledby="mfa-error-title">
            <h2 id="mfa-error-title" class="mt-0 mb-1 text-lg font-semibold">인증 앱 상태 확인 필요</h2>
            <p class="mt-0 mb-4 text-muted-color">인증 앱 상태를 다시 확인해 주세요.</p>
            <Button label="다시 시도" icon="pi pi-refresh" :loading="busy" :disabled="busy" @click="refresh" />
        </section>

        <template v-else>
            <section class="card" aria-labelledby="verified-factors-title">
                <div class="flex flex-col items-start justify-between gap-3 mb-4 sm:flex-row">
                    <div>
                        <h2 id="verified-factors-title" class="mt-0 mb-1 text-lg font-semibold">등록된 인증 앱</h2>
                        <p class="m-0 text-muted-color">인증에 사용할 수 있는 앱입니다.</p>
                    </div>
                    <Button label="새로고침" icon="pi pi-refresh" severity="secondary" outlined size="small" :disabled="busy" @click="refresh" />
                </div>

                <div v-if="factors.length" class="border-t border-surface-200 dark:border-surface-700">
                    <div v-for="factor in factors" :key="factor.id" class="flex items-center justify-between gap-4 py-3 border-b border-surface-200 dark:border-surface-700">
                        <span>{{ factor.friendly_name || 'Google Authenticator' }}</span>
                        <Button icon="pi pi-trash" severity="danger" text rounded :aria-label="(factor.friendly_name || '인증 앱') + ' 삭제'" :disabled="busy || factors.length <= 1" @click="remove(factor)" />
                    </div>
                </div>
                <p v-else class="m-0 text-muted-color">등록된 인증 앱이 없습니다.</p>
                <p v-if="factors.length <= 1" class="mt-3 mb-0 text-sm text-muted-color">마지막 인증 앱은 계정 보호를 위해 삭제할 수 없습니다.</p>
            </section>

            <section class="card" aria-labelledby="backup-factor-title">
                <div class="flex flex-col items-start justify-between gap-3 mb-4 sm:flex-row">
                    <div>
                        <h2 id="backup-factor-title" class="mt-0 mb-1 text-lg font-semibold">백업 인증 앱</h2>
                        <p class="m-0 text-muted-color">새 앱에는 고유한 이름이 자동으로 지정됩니다.</p>
                    </div>
                    <Button v-if="!enrollment" label="백업 인증 앱 추가" icon="pi pi-plus" :disabled="busy" @click="begin" />
                </div>

                <div v-if="enrollment" class="grid gap-4 justify-items-center sm:justify-items-start">
                    <img :src="qrSource" alt="백업 인증 앱 등록 QR 코드" class="w-48 h-48" />
                    <Button :label="manualKeyVisible ? '수동 키 숨기기' : '수동 키 표시'" severity="secondary" text :disabled="busy" @click="manualKeyVisible = !manualKeyVisible" />
                    <code v-if="manualKeyVisible" class="p-3 break-all border rounded-border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">{{ enrollment.secret }}</code>
                    <div class="grid w-full max-w-sm gap-2 justify-self-start">
                        <label for="backup-mfa-code" class="font-semibold">인증 코드</label>
                        <InputText id="backup-mfa-code" v-model="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" fluid :disabled="busy" />
                    </div>
                    <div class="flex flex-wrap gap-2 justify-self-start">
                        <Button label="백업 인증 완료" icon="pi pi-check" :loading="busy" :disabled="busy" @click="verify" />
                        <Button label="등록 취소" icon="pi pi-times" severity="secondary" text :disabled="busy" @click="cancel" />
                    </div>
                </div>
            </section>
        </template>
    </div>
</template>
