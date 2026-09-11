import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import AppTopbar from './AppTopbar.vue';

const toastAdd = vi.hoisted(() => vi.fn());
const authStore = {
    user: ref({ id: 'user-1', email: 'user@nexerp.test' }),
    profile: ref({ display_name: '박지민', department: '재무팀', role: 'user', is_active: true }),
    hasRole: vi.fn((roles) => roles.includes(authStore.profile.value?.role)),
    signOut: vi.fn()
};

vi.mock('@/stores/auth', () => ({ useAuthStore: () => authStore }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: toastAdd }) }));

const readSource = (...segments) => readFileSync(resolve(process.cwd(), ...segments), 'utf8');
const readLayoutSource = (name) => readSource('src', 'layout', name);
const wrappers = [];

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
};

const mountTopbar = async (path = '/') => {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'dashboard', component: { template: '<main />' } },
            { path: '/auth/login', name: 'login', component: { template: '<main />' } },
            { path: '/settings/company', component: { template: '<main />' } },
            { path: '/settings/access', component: { template: '<main />' } }
        ]
    });
    await router.push(path);
    await router.isReady();
    const wrapper = mount(AppTopbar, { attachTo: document.body, global: { plugins: [PrimeVue, router] } });
    wrappers.push(wrapper);
    return { wrapper, router };
};

const openProfileMenu = async (wrapper) => {
    await wrapper.get('[aria-controls="profile-actions-menu"]').trigger('click');
    await flushPromises();
};

beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    authStore.user.value = { id: 'user-1', email: 'user@nexerp.test' };
    authStore.profile.value = { display_name: '박지민', department: '재무팀', role: 'user', is_active: true };
    authStore.hasRole.mockClear();
    authStore.signOut.mockReset().mockResolvedValue(undefined);
    toastAdd.mockReset();
});

afterEach(() => {
    while (wrappers.length) wrappers.pop().unmount();
    document.body.innerHTML = '';
});

describe('ERP application shell', () => {
    it('renders the shared ERP navigation model through the animated Sakai menu item', () => {
        const source = readLayoutSource('AppMenu.vue');

        expect(source).toContain("import { erpMenu } from '@/data/erp'");
        expect(source).toContain('const model = erpMenu');
        expect(source).toContain('<app-menu-item');
    });

    it('keeps expandable menu groups operable and announced from the keyboard', () => {
        const source = readLayoutSource('AppMenuItem.vue');

        expect(source).toContain('@keydown="itemKeydown($event, item)"');
        expect(source).toContain(':aria-expanded="item.items ? isActive : undefined"');
        expect(source).toContain(':aria-controls="item.items ? submenuId : undefined"');
        expect(source).toContain(':id="submenuId"');
        expect(source).toContain('aria-hidden="true"');
    });

    it('treats the mobile navigation as a dismissible, focus-contained drawer', () => {
        const layoutSource = readLayoutSource('AppLayout.vue');
        const sidebarSource = readLayoutSource('AppSidebar.vue');

        expect(layoutSource).toContain("document.body.classList.add('blocked-scroll')");
        expect(layoutSource).toContain("event.key === 'Escape'");
        expect(layoutSource).toContain('focusableElements');
        expect(layoutSource).toContain("document.addEventListener('keydown', handleMobileMenuKeydown)");
        expect(layoutSource).toContain("window.addEventListener('resize', handleViewportResize)");
        expect(layoutSource).toContain('isDesktop() && layoutState.mobileMenuActive');
        expect(layoutSource).toContain(':inert="layoutState.mobileMenuActive ? true : undefined"');
        expect(layoutSource).toContain(':aria-hidden="layoutState.mobileMenuActive ? \'true\' : undefined"');
        expect(layoutSource).toContain("document.querySelector('.layout-main h1')");
        expect(layoutSource).toContain("heading.setAttribute('tabindex', '-1')");
        expect(layoutSource).toContain('handleDesktopOverlayKeydown');
        expect(layoutSource).toContain('layoutState.overlayMenuActive = false');
        expect(layoutSource).toContain('previousOverlayFocusedElement');
        expect(sidebarSource).toContain(':aria-modal="isMobileDialog ? \'true\' : undefined"');
        expect(sidebarSource).toContain(':aria-hidden="isSidebarHidden ? \'true\' : undefined"');
        expect(sidebarSource).toContain(':inert="isSidebarHidden ? true : undefined"');
        expect(sidebarSource).toContain("layoutConfig.menuMode === 'overlay'");
    });

    it('keeps the ERP shell within narrow mobile viewports', () => {
        const source = readLayoutSource('AppLayout.vue');

        expect(source).toContain('@media (max-width: 360px)');
        expect(source).toContain('padding-left: 1rem');
        expect(source).toContain('min-width: 0');
        expect(source).toContain('<main class="layout-main">');
        expect(source).toContain(':closeButtonProps="{ autofocus: false }"');
        expect(source).toContain('top: 4.25rem !important');
    });

    it('provides interactive ERP topbar popup menus while retaining layout controls', () => {
        const source = readLayoutSource('AppTopbar.vue');
        const configuratorSource = readLayoutSource('AppConfigurator.vue');

        expect(source).toContain('const notificationMenu = ref()');
        expect(source).toContain('const quickMenu = ref()');
        expect(source).toContain('const profileMenu = ref()');
        expect(source).toContain('notificationMenu.value.toggle(event)');
        expect(source).toContain('quickMenu.value.toggle(event)');
        expect(source).toContain('profileMenu.value.toggle(event)');
        expect(source).toContain('toggleMenu');
        expect(source).toContain('toggleDarkMode');
        expect(source).toContain('<AppConfigurator');
        expect(source).toContain(':aria-expanded="isMenuOpen"');
        expect(source).toContain('aria-controls="app-sidebar-navigation"');
        expect(source).toContain(':aria-label="menuToggleLabel"');
        expect(source).toContain(':aria-expanded="mobileActionsOpen"');
        expect(source).toContain('aria-controls="topbar-mobile-actions"');
        expect(source).toContain(':aria-expanded="configOpen"');
        expect(source).toContain('aria-controls="app-configurator"');
        expect(source).toContain(':aria-expanded="quickMenuOpen"');
        expect(source).toContain(':aria-expanded="notificationMenuOpen"');
        expect(source).toContain(':aria-expanded="profileMenuOpen"');
        expect(source).toContain("event.key !== 'Escape'");
        expect(source).toContain("event.target.closest?.('.p-menu')");
        expect(configuratorSource).toContain(':aria-pressed="layoutConfig.primary === primaryColor.name"');
        expect(configuratorSource).toContain(':aria-pressed="isSurfaceSelected(surface.name)"');
        expect(configuratorSource).toContain('ring-2 ring-primary');
        expect(configuratorSource).toContain('ring-offset-2 ring-offset-surface-0 dark:ring-offset-surface-900');
        expect(source).toContain('pendingApprovalCount');
        expect(source).toContain('NEXERP');
        expect(source).toContain('SAKAI ERP');
        expect(source).not.toContain('var(--primary-50)');
    });

    it('renders reactive authenticated identity values and matching accessible names', async () => {
        const { wrapper } = await mountTopbar();

        expect(wrapper.get('.erp-user-avatar').text()).toBe('박');
        expect(wrapper.get('.erp-user-copy strong').text()).toBe('박지민');
        expect(wrapper.get('.erp-user-copy small').text()).toBe('재무팀');
        expect(wrapper.get('[aria-controls="profile-actions-menu"]').attributes('aria-label')).toContain('박지민');

        authStore.profile.value = { display_name: '  ', department: '', role: 'approver', is_active: true };
        await nextTick();

        expect(wrapper.get('.erp-user-avatar').text()).toBe('U');
        expect(wrapper.get('.erp-user-copy strong').text()).toBe('user@nexerp.test');
        expect(wrapper.get('.erp-user-copy small').text()).toBe('결재자');
        expect(wrapper.get('[aria-controls="profile-actions-menu"]').attributes('aria-label')).toContain('user@nexerp.test');
    });

    it('keeps long profile text constrained while exposing each full value', async () => {
        const source = readLayoutSource('AppTopbar.vue');
        const longName = 'Very Long Database Profile Name That Must Not Expand The Topbar';
        const longDepartment = 'International Enterprise Operations And Strategic Planning Department';
        authStore.profile.value = { display_name: longName, department: longDepartment, role: 'user', is_active: true };
        const { wrapper } = await mountTopbar();

        expect(source).toMatch(/\.erp-user-copy\s*\{[^}]*min-width:\s*0;[^}]*max-width:/s);
        expect(source).toMatch(/\.erp-user-copy strong,\s*\.erp-user-copy small\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
        expect(source).toMatch(/@media \(max-width:\s*520px\)[\s\S]*\.erp-user-copy\s*\{[^}]*max-width:/);
        expect(wrapper.get('.erp-user-copy strong').text()).toBe(longName);
        expect(wrapper.get('.erp-user-copy strong').attributes('title')).toBe(longName);
        expect(wrapper.get('.erp-user-copy small').text()).toBe(longDepartment);
        expect(wrapper.get('.erp-user-copy small').attributes('title')).toBe(longDepartment);
        expect(wrapper.get('[aria-controls="profile-actions-menu"]').attributes('aria-label')).toContain(`${longName} · ${longDepartment}`);
    });

    it('falls back to generic Korean identity labels when profile and email are empty', async () => {
        authStore.user.value = { id: 'user-1', email: '  ' };
        authStore.profile.value = null;
        const { wrapper } = await mountTopbar();

        expect(wrapper.get('.erp-user-avatar').text()).toBe('계');
        expect(wrapper.get('.erp-user-copy strong').text()).toBe('계정');
        expect(wrapper.get('.erp-user-copy small').text()).toBe('사용자');
        await openProfileMenu(wrapper);
        expect(document.body.textContent).toContain('계정 · 사용자');
    });

    it('shows access administration only to administrators', async () => {
        const { wrapper } = await mountTopbar();

        await openProfileMenu(wrapper);
        expect(document.body.textContent).not.toContain('사용자 · 권한');

        authStore.profile.value = { display_name: '관리자', department: '', role: 'admin', is_active: true };
        await nextTick();
        expect(document.body.textContent).toContain('사용자 · 권한');
    });

    it('signs out once and replaces the current route with login', async () => {
        const pending = deferred();
        authStore.signOut.mockReturnValueOnce(pending.promise);
        const { wrapper, router } = await mountTopbar('/settings/company');
        const replace = vi.spyOn(router, 'replace');
        await openProfileMenu(wrapper);
        const logout = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('로그아웃'));
        const logoutCommand = logout.querySelector('a, button');

        logoutCommand.click();
        logoutCommand.click();
        await nextTick();

        expect(authStore.signOut).toHaveBeenCalledOnce();
        expect(wrapper.get('[aria-controls="profile-actions-menu"]').attributes('aria-label')).toContain('로그아웃 처리 중');

        pending.resolve();
        await flushPromises();
        expect(replace).toHaveBeenCalledWith({ name: 'login' });
    });

    it('stays on the current route and shows a normalized toast when sign-out fails', async () => {
        authStore.signOut.mockRejectedValueOnce(new Error('sentinel-secret-signout-detail'));
        const { wrapper, router } = await mountTopbar('/settings/company');
        const replace = vi.spyOn(router, 'replace');
        await openProfileMenu(wrapper);
        const logout = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('로그아웃'));
        const logoutCommand = logout.querySelector('a, button');

        logoutCommand.click();
        await flushPromises();

        expect(router.currentRoute.value.path).toBe('/settings/company');
        expect(replace).not.toHaveBeenCalled();
        expect(toastAdd).toHaveBeenCalledWith({
            severity: 'error',
            summary: '로그아웃 실패',
            detail: '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.',
            life: 3200
        });
        expect(JSON.stringify(toastAdd.mock.calls)).not.toContain('sentinel-secret-signout-detail');
    });

    it('brands the footer for the ERP demo', () => {
        const source = readLayoutSource('AppFooter.vue');

        expect(source).toContain('NEXERP');
        expect(source).toContain('SAKAI ERP');
    });

    it('uses an accessible primary tone and Korean PrimeVue labels', () => {
        const mainSource = readSource('src', 'main.js');
        const configuratorSource = readLayoutSource('AppConfigurator.vue');
        const themeSource = readSource('src', 'theme', 'erpTheme.js');

        expect(mainSource).toContain('erpThemePreset');
        expect(mainSource).toContain('koPrimeVueLocale');
        expect(themeSource).toContain("color: '{primary.700}'");
        expect(themeSource).toContain("firstPageLabel: '첫 페이지'");
        expect(themeSource).toContain("close: '닫기'");
        expect(configuratorSource).toContain("color: '{primary.700}'");
        expect(configuratorSource).toContain('주 색상');
        expect(configuratorSource).toContain('메뉴 모드');
    });
});
