<script setup>
import { useLayout } from '@/layout/composables/layout';
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppFooter from './AppFooter.vue';
import AppSidebar from './AppSidebar.vue';
import AppTopbar from './AppTopbar.vue';

const { layoutConfig, layoutState, hideMobileMenu, isDesktop } = useLayout();
const route = useRoute();
let previousFocusedElement = null;
let previousOverlayFocusedElement = null;
let desktopOverlayLifecycleActive = false;

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const containerClass = computed(() => {
    return {
        'layout-overlay': layoutConfig.menuMode === 'overlay',
        'layout-static': layoutConfig.menuMode === 'static',
        'layout-overlay-active': layoutState.overlayMenuActive,
        'layout-mobile-active': layoutState.mobileMenuActive,
        'layout-static-inactive': layoutState.staticMenuInactive
    };
});

const getFocusableElements = () => Array.from(document.querySelector('.layout-sidebar')?.querySelectorAll(focusableSelector) || []).filter((element) => element.offsetParent !== null);

const handleMobileMenuKeydown = (event) => {
    if (!layoutState.mobileMenuActive) return;

    if (event.key === 'Escape') {
        event.preventDefault();
        hideMobileMenu();
        return;
    }

    if (event.key !== 'Tab') return;

    const focusableElements = getFocusableElements();
    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);
    const sidebar = document.querySelector('.layout-sidebar');

    if (!firstElement || !lastElement) {
        event.preventDefault();
        sidebar?.focus();
        return;
    }

    if (event.shiftKey && (document.activeElement === firstElement || !sidebar?.contains(document.activeElement))) {
        event.preventDefault();
        lastElement.focus();
    } else if (!event.shiftKey && (document.activeElement === lastElement || !sidebar?.contains(document.activeElement))) {
        event.preventDefault();
        firstElement.focus();
    }
};

const handleViewportResize = () => {
    if (isDesktop() && layoutState.mobileMenuActive) hideMobileMenu();
    if (!isDesktop() && layoutState.overlayMenuActive) layoutState.overlayMenuActive = false;
};

const handleDesktopOverlayKeydown = (event) => {
    if (event.key !== 'Escape' || !desktopOverlayLifecycleActive) return;
    event.preventDefault();
    layoutState.overlayMenuActive = false;
};

watch(
    () => layoutState.mobileMenuActive,
    async (isOpen) => {
        if (isOpen) {
            previousFocusedElement = document.activeElement;
            document.body.classList.add('blocked-scroll');
            document.addEventListener('keydown', handleMobileMenuKeydown);
            await nextTick();
            getFocusableElements()[0]?.focus();
            return;
        }

        document.body.classList.remove('blocked-scroll');
        document.removeEventListener('keydown', handleMobileMenuKeydown);
        const focusTarget = previousFocusedElement?.isConnected ? previousFocusedElement : document.querySelector('.layout-menu-button');
        await nextTick();
        focusTarget?.focus();
        previousFocusedElement = null;
    }
);

watch([() => layoutState.overlayMenuActive, () => layoutConfig.menuMode], async ([isOpen, menuMode]) => {
    const shouldManageOverlay = isOpen && menuMode === 'overlay' && isDesktop();

    if (shouldManageOverlay && !desktopOverlayLifecycleActive) {
        desktopOverlayLifecycleActive = true;
        previousOverlayFocusedElement = document.activeElement;
        document.addEventListener('keydown', handleDesktopOverlayKeydown);
        await nextTick();
        getFocusableElements()[0]?.focus();
        return;
    }

    if (!shouldManageOverlay && desktopOverlayLifecycleActive) {
        desktopOverlayLifecycleActive = false;
        document.removeEventListener('keydown', handleDesktopOverlayKeydown);
        const focusTarget = previousOverlayFocusedElement?.isConnected ? previousOverlayFocusedElement : document.querySelector('.layout-menu-button');
        await nextTick();
        focusTarget?.focus();
        previousOverlayFocusedElement = null;
    }
});

watch(
    () => route.fullPath,
    async () => {
        await nextTick();
        const heading = document.querySelector('.layout-main h1');
        if (!heading) return;
        heading.setAttribute('tabindex', '-1');
        heading.focus();
    }
);

onMounted(() => {
    window.addEventListener('resize', handleViewportResize);
});

onBeforeUnmount(() => {
    document.body.classList.remove('blocked-scroll');
    document.removeEventListener('keydown', handleMobileMenuKeydown);
    document.removeEventListener('keydown', handleDesktopOverlayKeydown);
    window.removeEventListener('resize', handleViewportResize);
});
</script>

<template>
    <div class="layout-wrapper" :class="containerClass">
        <AppTopbar :inert="layoutState.mobileMenuActive ? true : undefined" :aria-hidden="layoutState.mobileMenuActive ? 'true' : undefined" />
        <AppSidebar />
        <div class="layout-main-container" :inert="layoutState.mobileMenuActive ? true : undefined" :aria-hidden="layoutState.mobileMenuActive ? 'true' : undefined">
            <main class="layout-main">
                <router-view />
            </main>
            <AppFooter />
        </div>
        <div class="layout-mask animate-fadein" aria-hidden="true" @click="hideMobileMenu" />
    </div>
    <Toast :closeButtonProps="{ autofocus: false }" />
</template>

<style lang="scss">
@media (max-width: 991px) {
    .p-toast {
        top: 4.25rem !important;
    }
}

@media (max-width: 360px) {
    .layout-wrapper .layout-topbar {
        padding-left: 1rem;
        padding-right: 1rem;
    }

    .layout-wrapper .layout-main-container {
        padding-left: 1rem !important;
        padding-right: 1rem;
    }

    .layout-wrapper .layout-main,
    .layout-wrapper .card,
    .layout-wrapper .card > * {
        min-width: 0;
    }

    .layout-wrapper .layout-main .grid > * {
        min-width: 0;
    }

    .layout-wrapper .layout-main > .grid {
        column-gap: 0;
    }

    .layout-wrapper .card {
        padding: 1rem;
    }

    .layout-wrapper .card .p-select,
    .layout-wrapper .card .p-inputnumber,
    .layout-wrapper .card .p-inputtext {
        min-width: 0;
        max-width: 100%;
    }

    .p-toast {
        left: 1rem !important;
        right: 1rem !important;
        width: auto !important;
    }
}
</style>
