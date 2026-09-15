<script setup>
import { useLayout } from '@/layout/composables/layout';
import { useErpStore } from '@/stores/erp';
import { useAuthStore } from '@/stores/auth';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';
import AppConfigurator from './AppConfigurator.vue';

const { layoutConfig, layoutState, toggleMenu, toggleDarkMode, getLayoutPreferences, isDarkTheme, isDesktop } = useLayout();
const router = useRouter();
const toast = useToast();
const authStore = useAuthStore();
const { pendingApprovals, pendingApprovalCount } = useErpStore();
const isMobileViewport = ref(!isDesktop());
const mobileActionsOpen = ref(false);
const configOpen = ref(false);
const quickMenuOpen = ref(false);
const notificationMenuOpen = ref(false);
const profileMenuOpen = ref(false);
const signingOut = ref(false);
const passwordDialog = ref(false);
const changingPassword = ref(false);
const passwordSubmitted = ref(false);
const passwordDraft = ref({ currentPassword: '', newPassword: '', confirmation: '' });
const configRegion = ref();
const configButton = ref();
const topbarActions = ref();
const mobileActionsButton = ref();

const isMenuOpen = computed(() => {
    if (isMobileViewport.value) return layoutState.mobileMenuActive;
    if (layoutConfig.menuMode === 'overlay') return layoutState.overlayMenuActive;
    return !layoutState.staticMenuInactive;
});
const menuToggleLabel = computed(() => (isMenuOpen.value ? '메뉴 닫기' : '메뉴 열기'));
const mobileActionsLabel = computed(() => (mobileActionsOpen.value ? '업무 메뉴 닫기' : '업무 메뉴 열기'));
const configLabel = computed(() => (configOpen.value ? '테마 설정 닫기' : '테마 설정 열기'));
const roleLabels = { admin: '관리자', approver: '결재자', user: '사용자' };
const displayName = computed(() => authStore.profile.value?.display_name?.trim() || authStore.profile.value?.login_id || '계정');
const department = computed(() => authStore.profile.value?.department?.trim() || roleLabels[authStore.profile.value?.role] || '사용자');
const avatar = computed(() => [...displayName.value][0]?.toUpperCase() || '계');
const profileMenuLabel = computed(() => `${displayName.value} · ${department.value} 계정 메뉴${signingOut.value ? ' 로그아웃 처리 중' : ''}`);
const profileMenuButtonLabel = computed(() => `${profileMenuLabel.value} ${profileMenuOpen.value ? '닫기' : '열기'}`);
const passwordErrors = computed(() => {
    const errors = {};
    const currentPassword = passwordDraft.value.currentPassword;
    const newPassword = passwordDraft.value.newPassword;
    if (!currentPassword.trim()) errors.currentPassword = '현재 비밀번호를 입력해 주세요.';
    if (newPassword.length < 8 || newPassword.length > 128 || !newPassword.trim()) errors.newPassword = '새 비밀번호는 8자 이상 128자 이하로 입력해 주세요.';
    else if (currentPassword === newPassword) errors.newPassword = '새 비밀번호는 현재 비밀번호와 다르게 입력해 주세요.';
    if (passwordDraft.value.confirmation !== newPassword) errors.confirmation = '새 비밀번호가 일치하지 않습니다.';
    return errors;
});

const updateViewportState = () => {
    isMobileViewport.value = !isDesktop();
    if (!isMobileViewport.value) mobileActionsOpen.value = false;
};

const notificationMenu = ref();
const quickMenu = ref();
const profileMenu = ref();

const openNotifications = (event) => notificationMenu.value.toggle(event);
const openQuickMenu = (event) => quickMenu.value.toggle(event);
const openProfileMenu = (event) => profileMenu.value.toggle(event);

const toggleConfig = () => {
    configOpen.value = !configOpen.value;
    if (configOpen.value) mobileActionsOpen.value = false;
};

const toggleMobileActions = () => {
    mobileActionsOpen.value = !mobileActionsOpen.value;
    if (mobileActionsOpen.value) configOpen.value = false;
};

const handleDocumentPointerDown = (event) => {
    if (event.target.closest?.('.p-menu')) return;
    if (configOpen.value && !configRegion.value?.contains(event.target)) configOpen.value = false;
    if (mobileActionsOpen.value && !topbarActions.value?.contains(event.target)) mobileActionsOpen.value = false;
};

const handleDocumentKeydown = async (event) => {
    if (event.key !== 'Escape') return;

    if (configOpen.value) {
        configOpen.value = false;
        await nextTick();
        configButton.value?.focus();
        return;
    }

    if (mobileActionsOpen.value) {
        mobileActionsOpen.value = false;
        await nextTick();
        mobileActionsButton.value?.focus();
    }
};

onMounted(() => {
    window.addEventListener('resize', updateViewportState);
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleDocumentKeydown);
});

onBeforeUnmount(() => {
    window.removeEventListener('resize', updateViewportState);
    document.removeEventListener('pointerdown', handleDocumentPointerDown);
    document.removeEventListener('keydown', handleDocumentKeydown);
});

const navigate = (to) => {
    mobileActionsOpen.value = false;
    router.push(to);
};
const showMessage = (summary, detail) => toast.add({ severity: 'info', summary, detail, life: 2600 });
const saveUiPreferenceSnapshot = async () => {
    try {
        await authStore.saveUiPreferences(getLayoutPreferences());
    } catch {
        toast.add({ severity: 'error', summary: 'UI 설정 저장 실패', detail: 'UI 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', life: 3200 });
    }
};
const toggleAndSaveDarkMode = async () => {
    await toggleDarkMode();
    await saveUiPreferenceSnapshot();
};
const passwordFailureDetail = (error) => {
    const allowedMessages = new Set([
        'Supabase 연결 정보가 설정되지 않았습니다.',
        '로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.',
        '계정 권한 정보를 확인할 수 없습니다. 관리자에게 문의해 주세요.',
        '비활성화된 계정입니다. 관리자에게 문의해 주세요.',
        '현재 비밀번호를 입력해 주세요.',
        '새 비밀번호는 8자 이상 128자 이하로 입력해 주세요.',
        '새 비밀번호는 현재 비밀번호와 다르게 입력해 주세요.',
        '현재 비밀번호가 올바르지 않습니다.',
        '로그인 상태가 변경되었습니다. 다시 로그인해 주세요.',
        '네트워크 연결을 확인한 후 다시 시도해 주세요.',
        '비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    ]);
    return allowedMessages.has(error?.message) ? error.message : '비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.';
};
const clearPasswordFields = () => {
    passwordDraft.value = { currentPassword: '', newPassword: '', confirmation: '' };
    passwordSubmitted.value = false;
};
const focusPasswordField = async (field = 'currentPassword') => {
    const ids = {
        currentPassword: 'profile-current-password',
        newPassword: 'profile-new-password',
        confirmation: 'profile-confirm-password'
    };
    await nextTick();
    document.getElementById(ids[field])?.focus();
};
const openPasswordDialog = () => {
    clearPasswordFields();
    passwordDialog.value = true;
};
const closePasswordDialog = () => {
    if (changingPassword.value) return;
    clearPasswordFields();
    passwordDialog.value = false;
};
const submitPasswordChange = async () => {
    if (changingPassword.value) return;
    passwordSubmitted.value = true;
    const firstError = ['currentPassword', 'newPassword', 'confirmation'].find((field) => passwordErrors.value[field]);
    if (firstError) {
        await focusPasswordField(firstError);
        return;
    }

    changingPassword.value = true;
    try {
        await authStore.changePassword(passwordDraft.value.currentPassword, passwordDraft.value.newPassword);
        toast.add({ severity: 'success', summary: '비밀번호 변경 완료', detail: '비밀번호가 안전하게 변경되었습니다.', life: 3000 });
        passwordDialog.value = false;
    } catch (error) {
        toast.add({ severity: 'error', summary: '비밀번호 변경 실패', detail: passwordFailureDetail(error), life: 3600 });
    } finally {
        clearPasswordFields();
        changingPassword.value = false;
    }
};
const signOut = async () => {
    if (signingOut.value) return;

    signingOut.value = true;
    try {
        await authStore.signOut();
    } catch {
        toast.add({ severity: 'error', summary: '로그아웃 실패', detail: '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.', life: 3200 });
        signingOut.value = false;
        return;
    }

    try {
        await router.replace({ name: 'login' });
    } catch {
        toast.add({ severity: 'error', summary: '화면 이동 실패', detail: '로그인 화면으로 이동하지 못했습니다. 다시 시도해 주세요.', life: 3200 });
    } finally {
        signingOut.value = false;
    }
};

const notificationItems = computed(() => [
    {
        label: `미처리 결재 ${pendingApprovalCount.value}건`,
        items: pendingApprovals.value.length
            ? pendingApprovals.value.map((approval) => ({ label: approval.title, icon: 'pi pi-check-square', command: () => navigate('/approvals') }))
            : [{ label: '미처리 결재가 없습니다', icon: 'pi pi-check-circle', disabled: true }]
    },
    {
        label: '운영 알림',
        items: [
            { label: '안전재고 미달 품목 18건', icon: 'pi pi-exclamation-triangle', command: () => navigate('/inventory/stock') },
            { label: '오늘 출하 예정 7건', icon: 'pi pi-send', command: () => navigate('/logistics/shipments') }
        ]
    }
]);

const quickItems = ref([
    {
        label: '빠른 업무',
        items: [
            { label: '견적 등록', icon: 'pi pi-file-edit', command: () => navigate('/sales/quotes') },
            { label: '발주 등록', icon: 'pi pi-shopping-bag', command: () => navigate('/purchasing/orders') },
            { label: '전표 등록', icon: 'pi pi-book', command: () => navigate('/finance/journals') },
            { label: '품목 조회', icon: 'pi pi-search', command: () => navigate('/master/items') }
        ]
    }
]);

const profileItems = computed(() => [
    {
        label: `${displayName.value} · ${department.value}`,
        items: [
            { label: '내 프로필', icon: 'pi pi-user', command: () => showMessage('내 프로필', '프로필 기능은 준비 중입니다.') },
            ...(authStore.profile.value?.is_active ? [{ label: '비밀번호 변경', icon: 'pi pi-key', command: openPasswordDialog }] : []),
            ...(authStore.profile.value?.is_active ? [{ label: '2단계 인증 관리', icon: 'pi pi-shield', command: () => navigate('/settings/security') }] : []),
            { label: '회사 · 사업장 설정', icon: 'pi pi-building', command: () => navigate('/settings/company') },
            ...(authStore.hasRole(['admin'])
                ? [
                      { label: '계정 관리', icon: 'pi pi-users', command: () => navigate('/settings/accounts') },
                      { label: '메뉴 권한 관리', icon: 'pi pi-shield', command: () => navigate('/settings/menu-permissions') }
                  ]
                : [])
        ]
    },
    { separator: true },
    { label: signingOut.value ? '로그아웃 중' : '로그아웃', icon: 'pi pi-sign-out', disabled: signingOut.value, command: signOut }
]);
</script>

<template>
    <div class="layout-topbar">
        <div class="layout-topbar-logo-container">
            <button type="button" class="layout-menu-button layout-topbar-action" :title="menuToggleLabel" :aria-label="menuToggleLabel" :aria-expanded="isMenuOpen" aria-controls="app-sidebar-navigation" @click="toggleMenu">
                <i class="pi pi-bars" aria-hidden="true"></i>
            </button>

            <router-link to="/" class="layout-topbar-logo" aria-label="NEXERP 대시보드">
                <span class="erp-logo-mark" aria-hidden="true"><i class="pi pi-box"></i></span>
                <span class="erp-brand-copy">
                    <strong>NEXERP</strong>
                    <small>업무관리 시스템</small>
                </span>
            </router-link>
        </div>

        <div ref="topbarActions" class="layout-topbar-actions">
            <div ref="configRegion" class="layout-config-menu">
                <button type="button" class="layout-topbar-action" :title="isDarkTheme ? '라이트 모드' : '다크 모드'" :aria-label="isDarkTheme ? '라이트 모드로 전환' : '다크 모드로 전환'" @click="toggleAndSaveDarkMode">
                    <i :class="['pi', { 'pi-moon': isDarkTheme, 'pi-sun': !isDarkTheme }]" aria-hidden="true"></i>
                </button>
                <div class="relative">
                    <button
                        ref="configButton"
                        type="button"
                        class="layout-topbar-action layout-topbar-action-highlight"
                        :title="configLabel"
                        :aria-label="configLabel"
                        aria-haspopup="true"
                        :aria-expanded="configOpen"
                        aria-controls="app-configurator"
                        @click="toggleConfig"
                    >
                        <i class="pi pi-palette" aria-hidden="true"></i>
                    </button>
                    <Transition enter-from-class="hidden" enter-active-class="p-anchored-overlay-enter-active" leave-to-class="hidden" leave-active-class="p-anchored-overlay-leave-active">
                        <AppConfigurator v-if="configOpen" id="app-configurator" />
                    </Transition>
                </div>
            </div>

            <button
                ref="mobileActionsButton"
                class="layout-topbar-menu-button layout-topbar-action"
                type="button"
                :title="mobileActionsLabel"
                :aria-label="mobileActionsLabel"
                aria-haspopup="true"
                :aria-expanded="mobileActionsOpen"
                aria-controls="topbar-mobile-actions"
                @click="toggleMobileActions"
            >
                <i class="pi pi-ellipsis-v" aria-hidden="true"></i>
            </button>

            <Transition enter-from-class="hidden" enter-active-class="p-anchored-overlay-enter-active" leave-to-class="hidden" leave-active-class="p-anchored-overlay-leave-active">
                <div v-if="!isMobileViewport || mobileActionsOpen" id="topbar-mobile-actions" class="layout-topbar-menu lg:block">
                    <div class="layout-topbar-menu-content">
                        <button
                            type="button"
                            class="layout-topbar-action"
                            :title="quickMenuOpen ? '빠른 업무 닫기' : '빠른 업무 열기'"
                            :aria-label="quickMenuOpen ? '빠른 업무 닫기' : '빠른 업무 열기'"
                            aria-haspopup="menu"
                            :aria-expanded="quickMenuOpen"
                            aria-controls="quick-actions-menu"
                            @click="openQuickMenu"
                        >
                            <i class="pi pi-bolt" aria-hidden="true"></i>
                            <span>빠른 업무</span>
                        </button>
                        <Menu id="quick-actions-menu" ref="quickMenu" :model="quickItems" :popup="true" @show="quickMenuOpen = true" @hide="quickMenuOpen = false" />

                        <button
                            type="button"
                            class="layout-topbar-action erp-notification-action"
                            :title="`미처리 결재 ${pendingApprovalCount}건`"
                            :aria-label="`미처리 결재 ${pendingApprovalCount}건 ${notificationMenuOpen ? '닫기' : '열기'}`"
                            aria-haspopup="menu"
                            :aria-expanded="notificationMenuOpen"
                            aria-controls="notification-actions-menu"
                            @click="openNotifications"
                        >
                            <i class="pi pi-bell" aria-hidden="true"></i>
                            <span>알림</span>
                            <span v-if="pendingApprovalCount" class="erp-notification-badge">{{ pendingApprovalCount }}</span>
                        </button>
                        <Menu id="notification-actions-menu" ref="notificationMenu" :model="notificationItems" :popup="true" @show="notificationMenuOpen = true" @hide="notificationMenuOpen = false" />

                        <button
                            type="button"
                            class="layout-topbar-action erp-user-action"
                            :title="profileMenuButtonLabel"
                            :aria-label="profileMenuButtonLabel"
                            aria-haspopup="menu"
                            :aria-expanded="profileMenuOpen"
                            aria-controls="profile-actions-menu"
                            @click="openProfileMenu"
                        >
                            <span class="erp-user-avatar" aria-hidden="true">{{ avatar }}</span>
                            <span class="erp-user-copy">
                                <strong :title="displayName">{{ displayName }}</strong>
                                <small :title="department">{{ department }}</small>
                            </span>
                            <i class="pi pi-angle-down erp-user-chevron" aria-hidden="true"></i>
                        </button>
                        <Menu id="profile-actions-menu" ref="profileMenu" :model="profileItems" :popup="true" :aria-label="profileMenuLabel" @show="profileMenuOpen = true" @hide="profileMenuOpen = false" />
                    </div>
                </div>
            </Transition>
        </div>

        <Dialog
            v-model:visible="passwordDialog"
            modal
            header="비밀번호 변경"
            :style="{ width: '32rem' }"
            :breakpoints="{ '640px': 'calc(100vw - 2rem)' }"
            :closable="!changingPassword"
            :closeOnEscape="!changingPassword"
            @show="focusPasswordField()"
            @hide="clearPasswordFields"
        >
            <form id="profile-password-form" class="password-form" novalidate @submit.prevent="submitPasswordChange">
                <div class="password-field">
                    <label for="profile-current-password">현재 비밀번호</label>
                    <Password
                        inputId="profile-current-password"
                        v-model="passwordDraft.currentPassword"
                        autocomplete="current-password"
                        :feedback="false"
                        toggleMask
                        fluid
                        required
                        :disabled="changingPassword"
                        :invalid="passwordSubmitted && Boolean(passwordErrors.currentPassword)"
                        :inputProps="{ autocomplete: 'current-password', 'aria-describedby': 'profile-current-password-error' }"
                    />
                    <small v-if="passwordSubmitted && passwordErrors.currentPassword" id="profile-current-password-error" class="password-error" role="alert">{{ passwordErrors.currentPassword }}</small>
                </div>
                <div class="password-field">
                    <label for="profile-new-password">새 비밀번호</label>
                    <Password
                        inputId="profile-new-password"
                        v-model="passwordDraft.newPassword"
                        autocomplete="new-password"
                        :feedback="false"
                        toggleMask
                        fluid
                        required
                        :disabled="changingPassword"
                        :invalid="passwordSubmitted && Boolean(passwordErrors.newPassword)"
                        :inputProps="{ autocomplete: 'new-password', minlength: 8, maxlength: 128, 'aria-describedby': 'profile-new-password-help profile-new-password-error' }"
                    />
                    <small id="profile-new-password-help" class="text-muted-color">8자 이상 128자 이하로 입력해 주세요.</small>
                    <small v-if="passwordSubmitted && passwordErrors.newPassword" id="profile-new-password-error" class="password-error" role="alert">{{ passwordErrors.newPassword }}</small>
                </div>
                <div class="password-field">
                    <label for="profile-confirm-password">새 비밀번호 확인</label>
                    <Password
                        inputId="profile-confirm-password"
                        v-model="passwordDraft.confirmation"
                        autocomplete="new-password"
                        :feedback="false"
                        toggleMask
                        fluid
                        required
                        :disabled="changingPassword"
                        :invalid="passwordSubmitted && Boolean(passwordErrors.confirmation)"
                        :inputProps="{ autocomplete: 'new-password', maxlength: 128, 'aria-describedby': 'profile-confirm-password-error' }"
                    />
                    <small v-if="passwordSubmitted && passwordErrors.confirmation" id="profile-confirm-password-error" class="password-error" role="alert">{{ passwordErrors.confirmation }}</small>
                </div>
            </form>

            <template #footer>
                <Button label="취소" icon="pi pi-times" severity="secondary" text :disabled="changingPassword" @click="closePasswordDialog" />
                <Button label="변경" icon="pi pi-check" type="submit" form="profile-password-form" :loading="changingPassword" :disabled="changingPassword || Boolean(Object.keys(passwordErrors).length)" />
            </template>
        </Dialog>
    </div>
</template>

<style scoped>
.erp-logo-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.45rem;
    height: 2.45rem;
    flex: 0 0 2.45rem;
    border-radius: 0.65rem;
    color: var(--primary-contrast-color);
    background: var(--primary-color);
    box-shadow: 0 0.35rem 0.9rem color-mix(in srgb, var(--primary-color), transparent 72%);
}

.erp-logo-mark i {
    font-size: 1.2rem;
}

.erp-brand-copy,
.erp-user-copy {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.05;
    letter-spacing: 0;
}

.erp-brand-copy strong {
    font-size: 1.15rem;
    font-weight: 700;
}

.erp-brand-copy small {
    margin-top: 0.2rem;
    color: var(--text-color-secondary);
    font-size: 0.62rem;
    font-weight: 700;
}

.erp-notification-action {
    position: relative;
}

.erp-notification-badge {
    position: absolute;
    display: inline-flex !important;
    align-items: center;
    justify-content: center;
    top: 0.1rem;
    right: 0.05rem;
    min-width: 1rem;
    height: 1rem;
    padding: 0 0.22rem;
    border: 2px solid var(--surface-card);
    border-radius: 999px;
    color: #fff;
    background: var(--p-red-500, #ef4444);
    font-size: 0.6rem !important;
    font-weight: 700;
    line-height: 1;
}

.layout-topbar .erp-user-action {
    width: auto;
    min-width: 8.75rem;
    max-width: min(15rem, 32vw);
    overflow: hidden;
    padding: 0.25rem 0.55rem 0.25rem 0.3rem;
    gap: 0.5rem;
    border-radius: var(--content-border-radius);
}

.erp-user-avatar {
    display: inline-flex !important;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    flex: 0 0 2rem;
    border-radius: 50%;
    color: var(--primary-color);
    background: color-mix(in srgb, var(--primary-color), transparent 86%);
    font-size: 0.78rem !important;
    font-weight: 700;
}

.erp-user-copy {
    display: flex !important;
    flex: 1 1 auto;
    min-width: 0;
    max-width: min(11rem, 24vw);
}

.erp-user-copy strong,
.erp-user-copy small {
    display: block;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.erp-user-copy strong {
    font-size: 0.8rem;
    font-weight: 700;
}

.erp-user-copy small {
    margin-top: 0.18rem;
    color: var(--text-color-secondary);
    font-size: 0.65rem;
}

.erp-user-chevron {
    font-size: 0.72rem !important;
    color: var(--text-color-secondary);
}

.password-form,
.password-field {
    min-width: 0;
}

.password-form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
}

.password-field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.password-field label {
    font-weight: 600;
}

.password-error {
    color: var(--p-red-600);
}

@media (max-width: 991px) {
    .erp-brand-copy small {
        display: none;
    }

    .layout-topbar .erp-user-action {
        width: 100%;
        min-width: 0;
        max-width: 100%;
    }

    .erp-user-copy {
        display: flex !important;
        max-width: min(11rem, calc(100vw - 9rem));
    }

    .erp-notification-badge {
        position: static;
        margin-left: auto;
        border-color: transparent;
    }
}

@media (max-width: 520px) {
    .layout-topbar {
        padding: 0 1rem;
    }

    .erp-brand-copy strong {
        font-size: 1rem;
    }

    .erp-user-copy {
        max-width: min(9rem, 42vw);
    }
}
</style>
