<script setup>
import { useLayout } from '@/layout/composables/layout';
import { useErpStore } from '@/stores/erp';
import { useAuthStore } from '@/stores/auth';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';
import AppConfigurator from './AppConfigurator.vue';

const { layoutConfig, layoutState, toggleMenu, toggleDarkMode, isDarkTheme, isDesktop } = useLayout();
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
const displayName = computed(() => authStore.profile.value?.display_name?.trim() || authStore.user.value?.email?.trim() || '계정');
const department = computed(() => authStore.profile.value?.department?.trim() || roleLabels[authStore.profile.value?.role] || '사용자');
const avatar = computed(() => [...displayName.value][0]?.toUpperCase() || '계');
const profileMenuLabel = computed(() => `${displayName.value} · ${department.value} 계정 메뉴${signingOut.value ? ' 로그아웃 처리 중' : ''}`);
const profileMenuButtonLabel = computed(() => `${profileMenuLabel.value} ${profileMenuOpen.value ? '닫기' : '열기'}`);

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
            { label: '회사 · 사업장 설정', icon: 'pi pi-building', command: () => navigate('/settings/company') },
            ...(authStore.hasRole(['admin']) ? [{ label: '사용자 · 권한', icon: 'pi pi-shield', command: () => navigate('/settings/access') }] : [])
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
                    <small>SAKAI ERP</small>
                </span>
            </router-link>
        </div>

        <div ref="topbarActions" class="layout-topbar-actions">
            <div ref="configRegion" class="layout-config-menu">
                <button type="button" class="layout-topbar-action" :title="isDarkTheme ? '라이트 모드' : '다크 모드'" :aria-label="isDarkTheme ? '라이트 모드로 전환' : '다크 모드로 전환'" @click="toggleDarkMode">
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
