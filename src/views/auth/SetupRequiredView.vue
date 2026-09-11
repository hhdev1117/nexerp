<script setup>
const props = defineProps({
    reloadPage: {
        type: Function,
        default: () => window.location.reload()
    }
});
</script>

<template>
    <main class="auth-shell">
        <section class="auth-panel" aria-labelledby="setup-title">
            <span class="status-icon" aria-hidden="true"><i class="pi pi-cog"></i></span>
            <p class="brand">NEXERP</p>
            <h1 id="setup-title">연결 설정이 필요합니다</h1>
            <p>ERP에 연결하려면 배포 환경에 다음 항목을 설정해 주세요.</p>
            <ul aria-label="필수 연결 설정">
                <li><code>VITE_SUPABASE_URL</code></li>
                <li><code>VITE_SUPABASE_PUBLISHABLE_KEY</code></li>
            </ul>
            <Button label="다시 확인" icon="pi pi-refresh" aria-label="연결 설정 다시 확인" @click="props.reloadPage" />
        </section>
    </main>
</template>

<style scoped>
.auth-shell {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: var(--surface-ground, var(--p-surface-100));
    color: var(--text-color, var(--p-surface-900));
}
.auth-panel {
    width: min(100%, 34rem);
    padding: 2rem;
    border: 1px solid var(--surface-border, var(--p-surface-200));
    border-top: 4px solid var(--primary-color, var(--p-primary-700));
    border-radius: 8px;
    background: var(--surface-card, var(--p-surface-0));
    text-align: center;
}
.status-icon {
    width: 3rem;
    height: 3rem;
    display: grid;
    place-items: center;
    margin: 0 auto 1rem;
    border-radius: 50%;
    background: var(--p-primary-50);
    color: var(--primary-color, var(--p-primary-700));
    font-size: 1.25rem;
}
.brand {
    margin: 0 0 1.5rem;
    font-weight: 700;
}
h1 {
    margin: 0 0 0.75rem;
    font-size: 1.65rem;
}
p {
    color: var(--text-color-secondary, var(--p-surface-500));
}
ul {
    display: grid;
    gap: 0.5rem;
    margin: 1.5rem 0;
    padding: 1rem;
    list-style: none;
    border: 1px solid var(--surface-border, var(--p-surface-200));
    border-radius: 6px;
    text-align: left;
}
code {
    overflow-wrap: anywhere;
    color: var(--text-color, var(--p-surface-900));
}
@media (max-width: 575px) {
    .auth-shell {
        padding: 0;
        background: var(--surface-card, var(--p-surface-0));
    }
    .auth-panel {
        min-height: 100vh;
        padding: 2rem 1.25rem;
        border: 0;
        border-top: 4px solid var(--primary-color, var(--p-primary-700));
        border-radius: 0;
    }
}
</style>
