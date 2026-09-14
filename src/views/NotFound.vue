<script setup>
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<template>
    <main class="flex items-center justify-center min-h-screen p-6 bg-surface-ground">
        <div class="w-full max-w-lg text-center card">
            <div class="flex items-center justify-center w-16 h-16 mx-auto mb-6 bg-primary-100 dark:bg-primary-400/10 rounded-border">
                <i class="text-3xl text-primary pi pi-compass" aria-hidden="true" />
            </div>
            <p class="mb-2 text-sm font-semibold tracking-wide text-primary">404</p>
            <h1 class="mb-3 text-2xl font-semibold text-surface-900 dark:text-surface-0">페이지를 찾을 수 없습니다</h1>
            <p class="mb-2 text-muted-color">요청한 주소에 해당하는 NEXERP 업무 화면이 없습니다. 주소를 다시 확인하거나 대시보드로 이동해 주세요.</p>
            <p class="mb-8 text-sm break-all text-muted-color" aria-label="요청 경로">{{ route.fullPath }}</p>
            <Button as="router-link" to="/" label="통합 대시보드로 이동" icon="pi pi-home" />
        </div>
    </main>
</template>
