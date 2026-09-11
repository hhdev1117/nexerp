<script setup></script>

<template>
    <div class="layout-footer">
        <span><strong>NEXERP</strong> 업무관리 시스템</span>
        <span class="erp-footer-divider" aria-hidden="true"></span>
        <span>SAKAI ERP · PrimeVue</span>
    </div>
</template>

<style scoped>
.layout-footer {
    justify-content: center;
    gap: 0.625rem;
    color: var(--text-color-secondary);
    letter-spacing: 0;
}

.layout-footer strong {
    color: var(--text-color);
}

.erp-footer-divider {
    width: 1px;
    height: 0.875rem;
    background: var(--surface-border);
}

@media (max-width: 520px) {
    .layout-footer {
        align-items: center;
        flex-direction: column;
        gap: 0.25rem;
    }

    .erp-footer-divider {
        display: none;
    }
}
</style>
