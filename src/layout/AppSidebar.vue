<script setup>
import { useLayout } from '@/layout/composables/layout';
import { getMenuParentPath } from '@/data/erp';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppMenu from './AppMenu.vue';

const { layoutConfig, layoutState, isDesktop, hasOpenOverlay } = useLayout();
const route = useRoute();
const sidebarRef = ref(null);
const isMobileViewport = ref(!isDesktop());
const isMobileDialog = computed(() => isMobileViewport.value && layoutState.mobileMenuActive);
const isSidebarHidden = computed(() => {
    if (isMobileViewport.value) return !layoutState.mobileMenuActive;
    if (layoutConfig.menuMode === 'overlay') return !layoutState.overlayMenuActive;
    return layoutState.staticMenuInactive;
});
let outsideClickListener = null;

const updateViewportState = () => {
    isMobileViewport.value = !isDesktop();
};

watch(
    () => route.path,
    (newPath) => {
        layoutState.activePath = getMenuParentPath(newPath) || newPath;

        layoutState.overlayMenuActive = false;
        layoutState.mobileMenuActive = false;
        layoutState.menuHoverActive = false;
    },
    { immediate: true }
);

watch(hasOpenOverlay, (newVal) => {
    if (isDesktop()) {
        if (newVal) bindOutsideClickListener();
        else unbindOutsideClickListener();
    }
});

onMounted(() => {
    window.addEventListener('resize', updateViewportState);
});

const bindOutsideClickListener = () => {
    if (!outsideClickListener) {
        outsideClickListener = (event) => {
            if (isOutsideClicked(event)) {
                layoutState.overlayMenuActive = false;
            }
        };

        document.addEventListener('click', outsideClickListener);
    }
};

const unbindOutsideClickListener = () => {
    if (outsideClickListener) {
        document.removeEventListener('click', outsideClickListener);
        outsideClickListener = null;
    }
};

const isOutsideClicked = (event) => {
    const topbarButtonEl = document.querySelector('.layout-menu-button');

    return !(sidebarRef.value.isSameNode(event.target) || sidebarRef.value.contains(event.target) || topbarButtonEl?.isSameNode(event.target) || topbarButtonEl?.contains(event.target));
};

onBeforeUnmount(() => {
    unbindOutsideClickListener();
    window.removeEventListener('resize', updateViewportState);
});
</script>

<template>
    <div
        id="app-sidebar-navigation"
        ref="sidebarRef"
        class="layout-sidebar"
        :role="isMobileDialog ? 'dialog' : 'navigation'"
        :aria-modal="isMobileDialog ? 'true' : undefined"
        :aria-hidden="isSidebarHidden ? 'true' : undefined"
        :inert="isSidebarHidden ? true : undefined"
        aria-label="ERP 주 메뉴"
        :tabindex="isMobileDialog ? -1 : undefined"
    >
        <AppMenu />
    </div>
</template>
