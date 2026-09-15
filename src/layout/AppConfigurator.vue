<script setup>
import { useLayout } from '@/layout/composables/layout';
import { useAuthStore } from '@/stores/auth';
import { useToast } from 'primevue/usetoast';

const authStore = useAuthStore();
const toast = useToast();
const { layoutConfig, isDarkTheme, changeMenuMode, changePreset, getLayoutPreferences, presetOptions, primaryColors, surfaces, updatePrimaryColor, updateSurfaceColor } = useLayout();
const menuModeOptions = [
    { label: '고정', value: 'static' },
    { label: '오버레이', value: 'overlay' }
];

const preferenceFailureDetail = (error) => {
    const allowedMessages = new Set(['로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.', '비활성화된 계정입니다. 관리자에게 문의해 주세요.', 'UI 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.']);
    return allowedMessages.has(error?.message) ? error.message : 'UI 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
};

const persistPreferences = async () => {
    try {
        await authStore.saveUiPreferences(getLayoutPreferences());
    } catch (error) {
        toast.add({ severity: 'error', summary: 'UI 설정 저장 실패', detail: preferenceFailureDetail(error), life: 3200 });
    }
};

const updateColors = async (type, color) => {
    if (type === 'primary') updatePrimaryColor(color.name);
    else updateSurfaceColor(color.name);
    await persistPreferences();
};

const onPresetChange = async (value) => {
    changePreset(value);
    await persistPreferences();
};

const onMenuModeChange = async (value) => {
    changeMenuMode(value);
    await persistPreferences();
};

const isSurfaceSelected = (name) => {
    const selectedSurface = layoutConfig.surface || (isDarkTheme.value ? 'zinc' : 'slate');
    return selectedSurface === name;
};
</script>

<template>
    <div class="config-panel absolute top-[3.25rem] right-0 w-64 p-4 bg-surface-0 dark:bg-surface-900 border border-surface rounded-border origin-top shadow-[0px_3px_5px_rgba(0,0,0,0.02),0px_0px_2px_rgba(0,0,0,0.05),0px_1px_4px_rgba(0,0,0,0.08)]">
        <div class="flex flex-col gap-4">
            <div>
                <span class="text-sm text-muted-color font-semibold">주 색상</span>
                <div class="pt-2 flex gap-2 flex-wrap justify-between">
                    <button
                        v-for="primaryColor of primaryColors"
                        :key="primaryColor.name"
                        type="button"
                        :title="primaryColor.name"
                        :aria-label="`${primaryColor.name} 주 색상`"
                        :aria-pressed="layoutConfig.primary === primaryColor.name"
                        @click="updateColors('primary', primaryColor)"
                        :class="[
                            'border-none w-5 h-5 rounded-full p-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                            { 'ring-2 ring-primary ring-offset-2 ring-offset-surface-0 dark:ring-offset-surface-900': layoutConfig.primary === primaryColor.name }
                        ]"
                        :style="{ backgroundColor: `${primaryColor.name === 'noir' ? 'var(--text-color)' : primaryColor.palette['500']}` }"
                    ></button>
                </div>
            </div>
            <div>
                <span class="text-sm text-muted-color font-semibold">표면 색상</span>
                <div class="pt-2 flex gap-2 flex-wrap justify-between">
                    <button
                        v-for="surface of surfaces"
                        :key="surface.name"
                        type="button"
                        :title="surface.name"
                        :aria-label="`${surface.name} 표면 색상`"
                        :aria-pressed="isSurfaceSelected(surface.name)"
                        @click="updateColors('surface', surface)"
                        :class="[
                            'border-none w-5 h-5 rounded-full p-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                            { 'ring-2 ring-primary ring-offset-2 ring-offset-surface-0 dark:ring-offset-surface-900': isSurfaceSelected(surface.name) }
                        ]"
                        :style="{ backgroundColor: `${surface.palette['500']}` }"
                    ></button>
                </div>
            </div>
            <div class="flex flex-col gap-2">
                <span class="text-sm text-muted-color font-semibold">프리셋</span>
                <SelectButton :modelValue="layoutConfig.preset" @update:modelValue="onPresetChange" :options="presetOptions" :allowEmpty="false" />
            </div>
            <div class="flex flex-col gap-2">
                <span class="text-sm text-muted-color font-semibold">메뉴 모드</span>
                <SelectButton :modelValue="layoutConfig.menuMode" @update:modelValue="onMenuModeChange" :options="menuModeOptions" :allowEmpty="false" optionLabel="label" optionValue="value" />
            </div>
        </div>
    </div>
</template>
