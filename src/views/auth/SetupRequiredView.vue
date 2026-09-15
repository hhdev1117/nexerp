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
        <section class="auth-panel auth-panel-wide auth-panel-centered" aria-labelledby="setup-title">
            <span class="auth-status-icon" aria-hidden="true"><i class="pi pi-cog"></i></span>
            <p class="mb-6 font-bold">NEXERP</p>
            <h1 id="setup-title" class="mt-0 mb-3 text-2xl font-semibold">연결 설정이 필요합니다</h1>
            <p class="m-0 text-muted-color">ERP에 연결하려면 배포 환경에 다음 항목을 설정해 주세요.</p>
            <ul aria-label="필수 연결 설정" class="grid gap-2 p-4 my-6 text-left list-none border rounded-border border-surface-200 dark:border-surface-700">
                <li><code class="break-all">VITE_SUPABASE_URL</code></li>
                <li><code class="break-all">VITE_SUPABASE_PUBLISHABLE_KEY</code></li>
            </ul>
            <Button label="다시 확인" icon="pi pi-refresh" aria-label="연결 설정 다시 확인" @click="props.reloadPage" />
        </section>
    </main>
</template>
