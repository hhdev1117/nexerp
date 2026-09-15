import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import AppMenu from './AppMenu.vue';
import AppTopbar from './AppTopbar.vue';
import AppConfigurator from './AppConfigurator.vue';
import { useLayout } from './composables/layout';

const toastAdd = vi.hoisted(() => vi.fn());
const themeHarness = vi.hoisted(() => {
    const builder = {};
    builder.preset = vi.fn(() => builder);
    builder.surfacePalette = vi.fn(() => builder);
    builder.use = vi.fn(() => builder);
    return { builder };
});
const authStore = {
    user: ref({ id: 'user-1' }),
    profile: ref({ display_name: '박지민', department: '재무팀', role: 'user', is_active: true }),
    hasRole: vi.fn((roles) => roles.includes(authStore.profile.value?.role)),
    changePassword: vi.fn(),
    saveUiPreferences: vi.fn(),
    signOut: vi.fn()
};
const accessStore = {
    canAccess: vi.fn()
};

vi.mock('@/stores/auth', () => ({ useAuthStore: () => authStore }));
vi.mock('@/stores/access', () => ({ useAccessStore: () => accessStore }));
const runtimeStore = { context: ref({ mode: 'legacy' }), canAccess: vi.fn(() => false) };
vi.mock('@/stores/enterpriseRuntime', () => ({ useEnterpriseRuntimeStore: () => runtimeStore }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: toastAdd }) }));
vi.mock('@primeuix/themes', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, $t: () => themeHarness.builder, updatePreset: vi.fn(), updateSurfacePalette: vi.fn() };
});

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
            { path: '/settings/accounts', component: { template: '<main />' } },
            { path: '/settings/security', component: { template: '<main />' } },
            { path: '/settings/menu-permissions', component: { template: '<main />' } }
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

const submitPasswordForm = async () => {
    document.querySelector('#profile-password-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
};

beforeEach(() => {
    runtimeStore.context.value = { mode: 'legacy' };
    runtimeStore.canAccess.mockReset().mockReturnValue(false);
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    });
    authStore.user.value = { id: 'user-1' };
    authStore.profile.value = { login_id: 'user01', display_name: '박지민', department: '재무팀', role: 'user', is_active: true };
    authStore.hasRole.mockClear();
    authStore.changePassword.mockReset().mockResolvedValue(undefined);
    authStore.saveUiPreferences.mockReset().mockResolvedValue(undefined);
    authStore.signOut.mockReset().mockResolvedValue(undefined);
    accessStore.canAccess.mockReset().mockReturnValue(false);
    toastAdd.mockReset();
    const { layoutConfig, layoutState } = useLayout();
    Object.assign(layoutConfig, { preset: 'Aura', primary: 'emerald', surface: null, darkTheme: false, menuMode: 'static' });
    Object.assign(layoutState, { staticMenuInactive: false, overlayMenuActive: false, mobileMenuActive: false, sidebarExpanded: false, menuHoverActive: false });
    document.documentElement.classList.remove('app-dark');
});

afterEach(() => {
    while (wrappers.length) wrappers.pop().unmount();
    document.body.innerHTML = '';
});

describe('ERP application shell', () => {
    it('renders the shared NEXERP navigation model through the animated menu item', () => {
        const source = readLayoutSource('AppMenu.vue');

        expect(source).toContain("import { erpMenu, filterMenuByAccess } from '@/data/erp'");
        expect(source).toContain('const model = computed');
        expect(source).toContain('<app-menu-item');
    });

    it('hides forbidden leaves and their empty parent groups using the current role permission', () => {
        const allowed = new Set(['dashboard', 'sales.orders']);
        accessStore.canAccess.mockImplementation((menuKey, role) => role === 'user' && allowed.has(menuKey));
        const wrapper = mount(AppMenu, {
            global: {
                stubs: {
                    RouterLink: { props: ['to'], template: '<a :data-to="to"><slot /></a>' }
                }
            }
        });
        wrappers.push(wrapper);

        expect(wrapper.text()).toContain('통합 대시보드');
        expect(wrapper.text()).toContain('영업관리');
        expect(wrapper.text()).toContain('수주 관리');
        expect(wrapper.text()).not.toContain('견적 관리');
        expect(wrapper.text()).not.toContain('구매관리');
        expect(wrapper.text()).not.toContain('분석 및 관리');
        expect(accessStore.canAccess).toHaveBeenCalledWith('sales.orders', 'user');
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

    it('releases the mobile drawer scroll lock across navigation and browser lifecycle exits', () => {
        const layoutSource = readLayoutSource('AppLayout.vue');

        expect(layoutSource).toContain('const releasePageScrollLock = () =>');
        expect(layoutSource).toContain("window.addEventListener('pageshow', handlePageShow)");
        expect(layoutSource).toContain("window.removeEventListener('pageshow', handlePageShow)");
        expect(layoutSource).toMatch(/handleViewportResize[\s\S]*releasePageScrollLock\(\)/);
        expect(layoutSource).toMatch(/\(\) => route\.fullPath[\s\S]*releasePageScrollLock\(\)[\s\S]*document\.querySelector\('\.layout-main h1'\)/);
        expect(layoutSource).toMatch(/onBeforeUnmount\(\(\) => \{[\s\S]*releasePageScrollLock\(\)/);
        expect((layoutSource.match(/releasePageScrollLock\(\)/g) || []).length).toBeGreaterThanOrEqual(5);
    });

    it('gives the mobile drawer an owned dynamic-viewport touch scroll container', () => {
        const menuSource = readSource('src', 'assets', 'layout', '_menu.scss');
        const responsiveSource = readSource('src', 'assets', 'layout', '_responsive.scss');

        expect(menuSource).toMatch(/\.layout-sidebar\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*overscroll-behavior:\s*contain;[\s\S]*touch-action:\s*pan-y;[\s\S]*-webkit-overflow-scrolling:\s*touch;[\s\S]*scrollbar-gutter:\s*stable;/);
        expect(responsiveSource).toMatch(/@media \(max-width: 991px\)[\s\S]*\.layout-sidebar\s*\{[\s\S]*height:\s*100vh;[\s\S]*height:\s*100dvh;[\s\S]*max-height:\s*100vh;[\s\S]*max-height:\s*100dvh;/);
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
        expect(source).toContain('업무관리 시스템');
        expect(source).toContain('2단계 인증 관리');
        expect(source).not.toContain('SAKAI ERP');
        expect(source).not.toContain('var(--primary-50)');
    });

    it('persists the complete layout snapshot when the signed-in user toggles dark mode', async () => {
        const { wrapper } = await mountTopbar();

        await wrapper.get('[aria-label="다크 모드로 전환"]').trigger('click');
        await flushPromises();

        expect(authStore.saveUiPreferences).toHaveBeenCalledWith({ preset: 'Aura', primary: 'emerald', surface: null, darkTheme: true, menuMode: 'static' });
        expect(document.documentElement.classList.contains('app-dark')).toBe(true);
    });

    it('keeps the session setting and reports a normalized message when preference persistence fails', async () => {
        authStore.saveUiPreferences.mockRejectedValueOnce(new Error('provider detail access_token=sentinel-secret'));
        const { wrapper } = await mountTopbar();

        await wrapper.get('[aria-label="다크 모드로 전환"]').trigger('click');
        await flushPromises();

        expect(document.documentElement.classList.contains('app-dark')).toBe(true);
        expect(toastAdd).toHaveBeenCalledWith({ severity: 'error', summary: 'UI 설정 저장 실패', detail: 'UI 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', life: 3200 });
        expect(JSON.stringify(toastAdd.mock.calls)).not.toContain('sentinel-secret');
    });

    it('does not show a failure toast when stale topbar and configurator saves are cancelled', async () => {
        authStore.saveUiPreferences.mockResolvedValue(null);
        const { wrapper: topbar } = await mountTopbar();

        await topbar.get('[aria-label="다크 모드로 전환"]').trigger('click');
        await flushPromises();

        const configurator = mount(AppConfigurator, { attachTo: document.body, global: { plugins: [PrimeVue] } });
        wrappers.push(configurator);
        await configurator.get('[aria-label="blue 주 색상"]').trigger('click');
        await flushPromises();

        expect(authStore.saveUiPreferences).toHaveBeenCalledTimes(2);
        expect(toastAdd).not.toHaveBeenCalled();
    });

    it('persists primary, surface, preset, and menu changes from the configurator', async () => {
        const wrapper = mount(AppConfigurator, { attachTo: document.body, global: { plugins: [PrimeVue] } });
        wrappers.push(wrapper);

        await wrapper.get('[aria-label="blue 주 색상"]').trigger('click');
        await flushPromises();
        expect(authStore.saveUiPreferences).toHaveBeenLastCalledWith({ preset: 'Aura', primary: 'blue', surface: null, darkTheme: false, menuMode: 'static' });

        await wrapper.get('[aria-label="stone 표면 색상"]').trigger('click');
        await flushPromises();
        expect(authStore.saveUiPreferences).toHaveBeenLastCalledWith({ preset: 'Aura', primary: 'blue', surface: 'stone', darkTheme: false, menuMode: 'static' });

        const laraButton = wrapper.findAll('button').find((button) => button.text() === 'Lara');
        await laraButton.trigger('click');
        await flushPromises();
        expect(authStore.saveUiPreferences).toHaveBeenLastCalledWith({ preset: 'Lara', primary: 'blue', surface: 'stone', darkTheme: false, menuMode: 'static' });

        const overlayButton = wrapper.findAll('button').find((button) => button.text() === '오버레이');
        await overlayButton.trigger('click');
        await flushPromises();
        expect(authStore.saveUiPreferences).toHaveBeenLastCalledWith({ preset: 'Lara', primary: 'blue', surface: 'stone', darkTheme: false, menuMode: 'overlay' });
        expect(authStore.saveUiPreferences).toHaveBeenCalledTimes(4);
    });

    it('renders reactive authenticated identity values and matching accessible names', async () => {
        const { wrapper } = await mountTopbar();

        expect(wrapper.get('.erp-user-avatar').text()).toBe('박');
        expect(wrapper.get('.erp-user-copy strong').text()).toBe('박지민');
        expect(wrapper.get('.erp-user-copy small').text()).toBe('재무팀');
        expect(wrapper.get('[aria-controls="profile-actions-menu"]').attributes('aria-label')).toContain('박지민');

        authStore.profile.value = { login_id: 'user01', display_name: '  ', department: '', role: 'approver', is_active: true };
        await nextTick();

        expect(wrapper.get('.erp-user-avatar').text()).toBe('U');
        expect(wrapper.get('.erp-user-copy strong').text()).toBe('user01');
        expect(wrapper.get('.erp-user-copy small').text()).toBe('결재자');
        expect(wrapper.get('[aria-controls="profile-actions-menu"]').attributes('aria-label')).toContain('user01');
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

    it('falls back to generic Korean identity labels when profile is unavailable', async () => {
        authStore.user.value = { id: 'user-1' };
        authStore.profile.value = null;
        const { wrapper } = await mountTopbar();

        expect(wrapper.get('.erp-user-avatar').text()).toBe('계');
        expect(wrapper.get('.erp-user-copy strong').text()).toBe('계정');
        expect(wrapper.get('.erp-user-copy small').text()).toBe('사용자');
        await openProfileMenu(wrapper);
        expect(document.body.textContent).toContain('계정 · 사용자');
    });

    it('shows access administration only to administrators', async () => {
        const { wrapper, router } = await mountTopbar();

        await openProfileMenu(wrapper);
        expect(document.body.textContent).not.toContain('사용자 · 권한');

        authStore.profile.value = { display_name: '관리자', department: '', role: 'admin', is_active: true };
        await nextTick();
        expect(document.body.textContent).toContain('계정 관리');
        expect(document.body.textContent).toContain('메뉴 권한 관리');

        const menuItems = [...document.querySelectorAll('[role="menuitem"]')];
        menuItems
            .find((item) => item.textContent.includes('계정 관리'))
            .querySelector('a, button')
            .click();
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/settings/accounts');
    });

    it('offers password change to every active account and hides it for inactive accounts', async () => {
        const { wrapper } = await mountTopbar();

        await openProfileMenu(wrapper);
        const passwordItem = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('비밀번호 변경'));
        expect(passwordItem).toBeTruthy();
        expect(passwordItem.querySelector('.pi-key')).toBeTruthy();

        authStore.profile.value = { ...authStore.profile.value, is_active: false };
        await nextTick();
        expect(document.body.textContent).not.toContain('비밀번호 변경');
    });

    it('validates password-change fields before calling the auth store', async () => {
        const { wrapper } = await mountTopbar();
        await openProfileMenu(wrapper);
        [...document.querySelectorAll('[role="menuitem"]')]
            .find((item) => item.textContent.includes('비밀번호 변경'))
            .querySelector('a, button')
            .click();
        await flushPromises();

        const current = document.querySelector('#profile-current-password');
        const next = document.querySelector('#profile-new-password');
        const confirmation = document.querySelector('#profile-confirm-password');
        expect(current.getAttribute('autocomplete')).toBe('current-password');
        expect(next.getAttribute('autocomplete')).toBe('new-password');
        expect(confirmation.getAttribute('autocomplete')).toBe('new-password');

        await submitPasswordForm();

        expect(authStore.changePassword).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('현재 비밀번호를 입력해 주세요.');
        expect(document.activeElement).toBe(current);
    });

    it.each([
        ['success', undefined, 'success', '비밀번호 변경 완료'],
        ['failure', new Error('sentinel-provider-secret'), 'error', '비밀번호 변경 실패']
    ])('clears password fields after %s completion', async (_case, failure, severity, summary) => {
        if (failure) authStore.changePassword.mockRejectedValueOnce(failure);
        const { wrapper } = await mountTopbar();
        await openProfileMenu(wrapper);
        [...document.querySelectorAll('[role="menuitem"]')]
            .find((item) => item.textContent.includes('비밀번호 변경'))
            .querySelector('a, button')
            .click();
        await flushPromises();

        const setValue = (selector, value) => {
            const input = document.querySelector(selector);
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        setValue('#profile-current-password', 'Current-Password-1!');
        setValue('#profile-new-password', 'Replacement-Password-2!');
        setValue('#profile-confirm-password', 'Replacement-Password-2!');
        await nextTick();
        await submitPasswordForm();

        expect(authStore.changePassword).toHaveBeenCalledWith('Current-Password-1!', 'Replacement-Password-2!');
        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity, summary }));
        expect(JSON.stringify(toastAdd.mock.calls)).not.toContain('sentinel-provider-secret');
        for (const selector of ['#profile-current-password', '#profile-new-password', '#profile-confirm-password']) {
            const input = document.querySelector(selector);
            if (input) expect(input.value).toBe('');
        }
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
        expect(source).not.toContain('SAKAI ERP');
    });

    it('uses an accessible primary tone and Korean PrimeVue labels', () => {
        const mainSource = readSource('src', 'main.js');
        const configuratorSource = readLayoutSource('AppConfigurator.vue');
        const themeSource = readSource('src', 'theme', 'erpTheme.js');
        const layoutThemeSource = readSource('src', 'theme', 'layoutTheme.js');

        expect(mainSource).toContain('erpThemePreset');
        expect(mainSource).toContain('koPrimeVueLocale');
        expect(themeSource).toContain("color: '{primary.700}'");
        expect(themeSource).toContain("firstPageLabel: '첫 페이지'");
        expect(themeSource).toContain("close: '닫기'");
        expect(layoutThemeSource).toContain("color: '{primary.700}'");
        expect(configuratorSource).toContain('주 색상');
        expect(configuratorSource).toContain('메뉴 모드');
    });
});

it('hides the HR ledger until published permissions are available', async () => {
    accessStore.canAccess.mockReturnValue(true);
    const wrapper = mount(AppMenu, { global: { stubs: { RouterLink: { props: ['to'], template: '<a><slot /></a>' } } } });
    wrappers.push(wrapper);
    expect(wrapper.text()).not.toContain('직원 · 인사발령');
    runtimeStore.context.value = { mode: 'active' };
    runtimeStore.canAccess.mockImplementation((key) => key === 'hr.core');
    await nextTick();
    expect(wrapper.text()).toContain('직원 · 인사발령');
    expect(wrapper.text()).not.toContain('수주 관리');
});

it('hides presentation-only menu keys without changing runtime route permission', async () => {
    runtimeStore.context.value = { mode: 'active', hiddenMenuKeys: ['hr.core'] };
    runtimeStore.canAccess.mockImplementation((key) => key === 'hr.core');
    const wrapper = mount(AppMenu, { global: { stubs: { RouterLink: { props: ['to'], template: '<a><slot /></a>' } } } });
    wrappers.push(wrapper);
    expect(wrapper.text()).not.toContain('직원 · 인사발령');
    expect(runtimeStore.canAccess('hr.core')).toBe(true);
    runtimeStore.context.value = { mode: 'active', hiddenMenuKeys: [] };
    await nextTick();
    expect(wrapper.text()).toContain('직원 · 인사발령');
});
