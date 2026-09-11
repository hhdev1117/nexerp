<script setup>
import { formatWon, statusSeverity } from '@/data/erp';
import { useErpStore } from '@/stores/erp';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const menu = ref(null);
const menuOpen = ref(false);
const { pendingApprovals } = useErpStore();

const items = [
    { label: '결재함 열기', icon: 'pi pi-fw pi-check-square', command: () => router.push('/approvals') },
    { label: '감사 로그', icon: 'pi pi-fw pi-history', command: () => router.push('/settings/audit') }
];

const operationalNotices = [
    { icon: 'pi-exclamation-triangle', tone: 'orange', title: '정우산업 수주 납기 지연', detail: 'SO-260910-036 · 납기일 2026-09-12' },
    { icon: 'pi-send', tone: 'blue', title: '부산 물류센터 출하 완료', detail: '오늘 출하 요청 12건이 처리되었습니다.' }
];

const toneClasses = {
    blue: { container: 'bg-blue-100 dark:bg-blue-400/10', icon: 'text-blue-500' },
    orange: { container: 'bg-orange-100 dark:bg-orange-400/10', icon: 'text-orange-500' }
};

function toggleMenu(event) {
    menu.value.toggle(event);
}
</script>

<template>
    <div class="card">
        <div class="flex items-center justify-between mb-6">
            <div>
                <h2 class="font-semibold text-xl">업무 알림</h2>
                <div class="mt-1 text-sm text-muted-color">확인이 필요한 결재와 운영 이슈입니다.</div>
            </div>
            <div>
                <Button icon="pi pi-ellipsis-v" text plain rounded :aria-label="menuOpen ? '업무 알림 메뉴 닫기' : '업무 알림 메뉴 열기'" aria-haspopup="menu" :aria-expanded="menuOpen" aria-controls="notification-widget-menu" @click="toggleMenu" />
                <Menu id="notification-widget-menu" ref="menu" popup :model="items" class="min-w-40!" @show="menuOpen = true" @hide="menuOpen = false" />
            </div>
        </div>

        <span class="block text-muted-color font-medium mb-3">결재 요청</span>
        <ul class="p-0 m-0 mb-6 list-none">
            <li v-for="approval in pendingApprovals" :key="approval.id" class="border-b border-surface last:border-b-0">
                <RouterLink to="/approvals" class="flex items-start gap-4 py-3 text-color no-underline rounded-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                    <div class="w-12 h-12 flex items-center justify-center bg-primary-100 dark:bg-primary-400/10 rounded-full shrink-0">
                        <i class="pi pi-file-check text-xl! text-primary" aria-hidden="true"></i>
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-surface-900 dark:text-surface-0 font-medium">{{ approval.title }}</span>
                            <Tag :value="approval.status" :severity="statusSeverity(approval.status)" />
                        </div>
                        <div class="mt-1 text-sm text-muted-color">{{ approval.requester }} · {{ approval.type }} · {{ formatWon(approval.amount) }}</div>
                        <div class="mt-1 text-xs text-muted-color">{{ approval.requestedAt }}</div>
                    </div>
                </RouterLink>
            </li>
            <li v-if="!pendingApprovals.length" class="py-4 text-sm text-muted-color">처리 대기 중인 결재가 없습니다.</li>
        </ul>

        <span class="block text-muted-color font-medium mb-3">운영 알림</span>
        <ul class="p-0 m-0 list-none">
            <li v-for="notice in operationalNotices" :key="notice.title" class="flex items-center gap-4 py-3 border-b border-surface last:border-b-0">
                <div class="w-12 h-12 flex items-center justify-center rounded-full shrink-0" :class="toneClasses[notice.tone].container">
                    <i class="pi text-xl!" :class="[notice.icon, toneClasses[notice.tone].icon]" aria-hidden="true"></i>
                </div>
                <div class="min-w-0">
                    <div class="text-surface-900 dark:text-surface-0 font-medium">{{ notice.title }}</div>
                    <div class="mt-1 text-sm text-muted-color">{{ notice.detail }}</div>
                </div>
            </li>
        </ul>
    </div>
</template>
