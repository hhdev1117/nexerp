import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readLayoutSource = (name) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

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

    it('brands the footer for the ERP demo', () => {
        const source = readLayoutSource('AppFooter.vue');

        expect(source).toContain('NEXERP');
        expect(source).toContain('SAKAI ERP');
    });

    it('uses an accessible primary tone and Korean PrimeVue labels', () => {
        const mainSource = readFileSync(fileURLToPath(new URL('../main.js', import.meta.url)), 'utf8');
        const configuratorSource = readLayoutSource('AppConfigurator.vue');
        const themeSource = readFileSync(fileURLToPath(new URL('../theme/erpTheme.js', import.meta.url)), 'utf8');

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
