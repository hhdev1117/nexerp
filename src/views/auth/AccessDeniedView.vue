<template>
    <main class="auth-shell">
        <section class="auth-panel" aria-labelledby="access-title">
            <span class="status-icon" aria-hidden="true"><i class="pi pi-lock"></i></span>
            <p class="brand">NEXERP</p>
            <h1 id="access-title">접근 권한이 없습니다</h1>
            <p>로그인한 계정에는 이 업무를 볼 권한이 없습니다. 필요한 경우 관리자에게 문의해 주세요.</p>
            <Button as="router-link" to="/" label="대시보드로 돌아가기" icon="pi pi-arrow-left" />
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
    background: var(--p-red-50);
    color: var(--p-red-600);
    font-size: 1.25rem;
}
.brand {
    margin: 0 0 1.5rem;
    font-weight: 700;
    color: var(--text-color, var(--p-surface-900));
}
h1 {
    margin: 0 0 0.75rem;
    font-size: 1.65rem;
}
p {
    margin: 0 0 1.5rem;
    color: var(--text-color-secondary, var(--p-surface-500));
    line-height: 1.65;
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
