<script setup>
import { inventoryRows } from '@/data/erp';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const menu = ref(null);
const menuOpen = ref(false);

const items = [
    { label: '재고 현황', icon: 'pi pi-fw pi-chart-bar', command: () => router.push('/inventory/stock') },
    { label: '품목 관리', icon: 'pi pi-fw pi-tags', command: () => router.push('/inventory/items') }
];

const stockItems = computed(() => {
    const priority = { 긴급: 0, 부족: 1, 정상: 2 };

    return inventoryRows.map((item) => ({ ...item, ratio: Math.min(100, Math.round((item.stock / item.safety) * 100)) })).sort((a, b) => priority[a.status] - priority[b.status]);
});

const statusClasses = {
    긴급: { bar: 'bg-red-500', text: 'text-red-700 dark:text-red-400' },
    부족: { bar: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-400' },
    정상: { bar: 'bg-primary', text: 'text-primary' }
};

function toggleMenu(event) {
    menu.value.toggle(event);
}
</script>

<template>
    <div class="card">
        <div class="flex justify-between items-center mb-6">
            <div>
                <h2 class="font-semibold text-xl">재고 위험 현황</h2>
                <div class="mt-1 text-sm text-muted-color">안전재고 대비 현재 가용 재고입니다.</div>
            </div>
            <div>
                <Button icon="pi pi-ellipsis-v" text plain rounded :aria-label="menuOpen ? '재고 메뉴 닫기' : '재고 메뉴 열기'" aria-haspopup="menu" :aria-expanded="menuOpen" aria-controls="stock-widget-menu" @click="toggleMenu" />
                <Menu id="stock-widget-menu" ref="menu" popup :model="items" class="min-w-40!" @show="menuOpen = true" @hide="menuOpen = false" />
            </div>
        </div>

        <ul class="list-none p-0 m-0">
            <li v-for="item in stockItems" :key="item.code" class="flex flex-col md:flex-row md:items-center md:justify-between mb-6 last:mb-0">
                <div class="min-w-0">
                    <span class="text-surface-900 dark:text-surface-0 font-medium mr-2">{{ item.name }}</span>
                    <div class="mt-1 text-sm text-muted-color">{{ item.code }} · {{ item.warehouse }}</div>
                </div>
                <div class="mt-3 md:mt-0 md:ml-6 flex items-center shrink-0">
                    <div class="bg-surface-300 dark:bg-surface-500 rounded-border overflow-hidden w-32 lg:w-24" style="height: 8px">
                        <div class="h-full transition-all duration-300" :class="statusClasses[item.status].bar" :style="{ width: `${item.ratio}%` }" aria-hidden="true"></div>
                    </div>
                    <span class="ml-3 min-w-10 text-sm font-medium" :class="statusClasses[item.status].text">{{ item.status }}</span>
                    <span class="ml-4 min-w-24 text-right font-medium" :class="statusClasses[item.status].text">{{ item.stock }} / {{ item.safety }} {{ item.unit }}</span>
                </div>
            </li>
        </ul>
    </div>
</template>
