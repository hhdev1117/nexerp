<script setup>
import { ref } from 'vue';
import { useRegisterSW } from 'virtual:pwa-register/vue';

const { needRefresh, updateServiceWorker } = useRegisterSW({ immediate: true });
const updating = ref(false);
const updateFailed = ref(false);

async function applyUpdate() {
    if (updating.value) return;
    updating.value = true;
    updateFailed.value = false;
    try {
        await updateServiceWorker(true);
    } catch {
        updateFailed.value = true;
    } finally {
        updating.value = false;
    }
}
</script>

<template>
    <aside v-if="needRefresh" class="pwa-update" role="status" aria-live="polite" aria-label="앱 업데이트">
        <p>{{ updateFailed ? '업데이트하지 못했습니다. 다시 시도해 주세요.' : '새 버전이 준비되었습니다. 작업을 저장한 뒤 업데이트해 주세요.' }}</p>
        <div class="pwa-update-actions">
            <Button label="나중에" severity="secondary" text :disabled="updating" @click="needRefresh = false" />
            <Button label="업데이트" icon="pi pi-refresh" :loading="updating" :disabled="updating" @click="applyUpdate" />
        </div>
    </aside>
</template>

<style scoped>
.pwa-update {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 1100;
    width: min(26rem, calc(100% - 2rem));
    padding: 1rem;
    border: 1px solid var(--surface-border);
    border-radius: 8px;
    background: var(--surface-card);
    color: var(--text-color);
    box-shadow: 0 4px 18px rgb(0 0 0 / 14%);
}

.pwa-update p {
    margin: 0 0 0.75rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
}

.pwa-update-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
</style>
