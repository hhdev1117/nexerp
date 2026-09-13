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
    <section class="security-settings" aria-labelledby="security-title">
        <ConfirmDialog />
        <header>
            <h1 id="security-title">인증 앱 관리</h1>
            <p>백업 인증 앱을 추가해 계정 복구를 준비하세요.</p>
        </header>

        <p v-if="message" class="security-alert" role="alert">{{ message }}</p>

        <section v-if="cleanupPending" aria-labelledby="cleanup-title">
            <h2 id="cleanup-title">등록 정리</h2>
            <p>이전 인증 앱 등록을 정리한 후 다시 시도해 주세요.</p>
            <Button label="등록 정리 다시 시도" icon="pi pi-refresh" :loading="busy" :disabled="busy" @click="retryCleanup" />
        </section>

        <section v-else-if="hasMfaError" aria-labelledby="mfa-error-title">
            <h2 id="mfa-error-title">인증 앱 상태 확인 필요</h2>
            <p>인증 앱 상태를 다시 확인해 주세요.</p>
            <Button label="다시 시도" icon="pi pi-refresh" :loading="busy" :disabled="busy" @click="refresh" />
        </section>

        <template v-else>
            <section aria-labelledby="verified-factors-title">
                <div class="section-heading">
                    <div>
                        <h2 id="verified-factors-title">등록된 인증 앱</h2>
                        <p>인증에 사용할 수 있는 앱입니다.</p>
                    </div>
                    <Button label="새로고침" icon="pi pi-refresh" severity="secondary" text :disabled="busy" @click="refresh" />
                </div>

                <div v-if="factors.length" class="factor-list">
                    <div v-for="factor in factors" :key="factor.id" class="factor-row">
                        <span>{{ factor.friendly_name || 'Google Authenticator' }}</span>
                        <Button icon="pi pi-trash" severity="danger" text :aria-label="`${factor.friendly_name || '인증 앱'} 삭제`" :disabled="busy || factors.length <= 1" @click="remove(factor)" />
                    </div>
                </div>
                <p v-else class="muted">등록된 인증 앱이 없습니다.</p>
                <p v-if="factors.length <= 1" class="last-factor-note">마지막 인증 앱은 계정 보호를 위해 삭제할 수 없습니다.</p>
            </section>

            <section aria-labelledby="backup-factor-title">
                <div class="section-heading">
                    <div>
                        <h2 id="backup-factor-title">백업 인증 앱</h2>
                        <p>새 앱에는 고유한 이름이 자동으로 지정됩니다.</p>
                    </div>
                    <Button v-if="!enrollment" label="백업 인증 앱 추가" icon="pi pi-plus" :disabled="busy" @click="begin" />
                </div>

                <div v-if="enrollment" class="enrollment">
                    <img :src="qrSource" alt="백업 인증 앱 등록 QR 코드" />
                    <Button :label="manualKeyVisible ? '수동 키 숨기기' : '수동 키 표시'" severity="secondary" text :disabled="busy" @click="manualKeyVisible = !manualKeyVisible" />
                    <code v-if="manualKeyVisible" class="manual-key">{{ enrollment.secret }}</code>
                    <div class="security-field">
                        <label for="backup-mfa-code">인증 코드</label>
                        <InputText id="backup-mfa-code" v-model="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" fluid :disabled="busy" />
                    </div>
                    <div class="enrollment-actions">
                        <Button label="백업 인증 완료" icon="pi pi-check" :loading="busy" :disabled="busy" @click="verify" />
                        <Button label="등록 취소" icon="pi pi-times" severity="secondary" text :disabled="busy" @click="cancel" />
                    </div>
                </div>
            </section>
        </template>
    </section>
</template>

<style scoped>
.security-settings {
    display: grid;
    gap: 2rem;
    max-width: 48rem;
}
.security-settings h1,
.security-settings h2,
.security-settings p {
    margin-top: 0;
}
.security-settings h1 {
    margin-bottom: 0.45rem;
}
.security-settings h2 {
    margin-bottom: 0.3rem;
    font-size: 1.1rem;
}
.security-settings header > p,
.section-heading p,
.muted {
    color: var(--text-color-secondary);
}
.security-alert {
    padding: 0.75rem;
    border: 1px solid var(--p-red-300);
    border-radius: 6px;
    background: var(--p-red-50);
    color: var(--p-red-700);
}
.section-heading {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 1rem;
    margin-bottom: 0.75rem;
}
.factor-list {
    border-top: 1px solid var(--surface-border);
}
.factor-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.8rem 0;
    border-bottom: 1px solid var(--surface-border);
}
.last-factor-note {
    margin: 0.75rem 0 0;
    color: var(--text-color-secondary);
    font-size: 0.9rem;
}
.enrollment {
    display: grid;
    gap: 0.9rem;
}
.enrollment img {
    width: 12rem;
    height: 12rem;
}
.manual-key {
    padding: 0.75rem;
    border: 1px solid var(--surface-border);
    border-radius: 6px;
    overflow-wrap: anywhere;
    background: var(--surface-ground);
}
.security-field {
    display: grid;
    gap: 0.5rem;
    max-width: 22rem;
}
.security-field label {
    font-weight: 600;
}
.enrollment-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}
@media (max-width: 575px) {
    .section-heading {
        align-items: stretch;
        flex-direction: column;
    }
    .enrollment img {
        justify-self: center;
    }
}
</style>
