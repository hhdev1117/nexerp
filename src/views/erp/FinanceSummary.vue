<script setup>
import { formatWon, statusSeverity } from '@/data/erp';
import { useLayout } from '@/layout/composables/layout';
import { onMounted, ref, watch } from 'vue';

const { layoutConfig, isDarkTheme } = useLayout();
const chartData = ref(null);
const chartOptions = ref(null);
const financeTrend = {
    labels: ['4월', '5월', '6월', '7월', '8월', '9월'],
    sales: [312, 356, 408, 382, 476, 534],
    purchases: [238, 274, 302, 298, 341, 368]
};
const chartPassThrough = {
    canvas: {
        role: 'img',
        'aria-label': '최근 6개월 월별 매출 및 매입 추이 차트. 상세 수치는 이어지는 데이터 표를 참조하세요.'
    }
};

const summaryCards = [
    { label: '당월 매출', value: 534200000, delta: '+12.4%', note: '전월 대비', icon: 'pi-chart-line', background: 'bg-blue-100 dark:bg-blue-400/10', color: 'text-blue-500' },
    { label: '당월 매입', value: 368100000, delta: '+4.8%', note: '전월 대비', icon: 'pi-shopping-bag', background: 'bg-orange-100 dark:bg-orange-400/10', color: 'text-orange-500' },
    { label: '매출채권', value: 87400000, delta: '6건', note: '연체 채권', icon: 'pi-arrow-down-left', background: 'bg-cyan-100 dark:bg-cyan-400/10', color: 'text-cyan-500' },
    { label: '가용 자금', value: 231800000, delta: '43.4%', note: '매출 대비', icon: 'pi-wallet', background: 'bg-purple-100 dark:bg-purple-400/10', color: 'text-purple-500' }
];

const financeRows = [
    { account: '외상매출금', partner: '세림유통', reference: 'AR-260911-032', dueDate: '2026-09-18', amount: 8420000, status: '승인 완료' },
    { account: '외상매입금', partner: '대한소재', reference: 'AP-260911-021', dueDate: '2026-09-15', amount: 18400000, status: '승인 대기' },
    { account: '미수금', partner: '한빛테크', reference: 'AR-260910-087', dueDate: '2026-09-12', amount: 3180000, status: '납기 지연' },
    { account: '운반비', partner: '부산로지스', reference: 'JV-260910-114', dueDate: '2026-09-20', amount: 2650000, status: '검토 중' },
    { account: '제품매출', partner: '미래상사', reference: 'AR-260909-076', dueDate: '2026-09-22', amount: 12700000, status: '승인 완료' }
];

function configureChart() {
    const documentStyle = getComputedStyle(document.documentElement);
    const textColor = documentStyle.getPropertyValue('--text-color');
    const mutedColor = documentStyle.getPropertyValue('--text-color-secondary');
    const borderColor = documentStyle.getPropertyValue('--surface-border');

    chartData.value = {
        labels: financeTrend.labels,
        datasets: [
            {
                label: '매출',
                data: financeTrend.sales,
                borderColor: documentStyle.getPropertyValue('--p-primary-500'),
                backgroundColor: documentStyle.getPropertyValue('--p-primary-100'),
                tension: 0.35,
                fill: true
            },
            {
                label: '매입',
                data: financeTrend.purchases,
                borderColor: documentStyle.getPropertyValue('--p-orange-500'),
                backgroundColor: 'transparent',
                tension: 0.35
            }
        ]
    };

    chartOptions.value = {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: textColor, usePointStyle: true } } },
        scales: {
            x: { ticks: { color: mutedColor }, grid: { display: false } },
            y: {
                beginAtZero: true,
                ticks: { color: mutedColor, callback: (value) => `${value}M` },
                grid: { color: borderColor }
            }
        }
    };
}

watch([() => layoutConfig.primary, () => layoutConfig.surface, isDarkTheme], configureChart);
onMounted(configureChart);
</script>

<template>
    <div>
        <div class="mb-6">
            <h1 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">재무 현황</h1>
            <div class="mt-1 text-muted-color">매출, 매입, 채권과 가용 자금을 한눈에 확인합니다.</div>
        </div>

        <div class="grid grid-cols-12 gap-6 mb-6">
            <div v-for="card in summaryCards" :key="card.label" class="col-span-12 md:col-span-6 xl:col-span-3">
                <div class="card h-full mb-0">
                    <div class="flex items-start justify-between gap-4">
                        <div>
                            <div class="mb-3 text-sm font-medium text-muted-color">{{ card.label }}</div>
                            <div class="text-xl font-semibold">{{ formatWon(card.value) }}</div>
                        </div>
                        <div :class="['flex items-center justify-center w-10 h-10 rounded-border shrink-0', card.background]">
                            <i :class="['pi text-xl', card.icon, card.color]" aria-hidden="true" />
                        </div>
                    </div>
                    <div class="mt-4 text-sm">
                        <span class="font-medium text-primary">{{ card.delta }}</span> <span class="text-muted-color">{{ card.note }}</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-12 gap-6">
            <div class="col-span-12 xl:col-span-7">
                <div class="card h-full mb-0">
                    <div class="flex items-center justify-between mb-6">
                        <div>
                            <h2 class="text-xl font-semibold">월별 매출 · 매입</h2>
                            <div class="mt-1 text-sm text-muted-color">단위: 백만원</div>
                        </div>
                        <Tag value="최근 6개월" severity="secondary" />
                    </div>
                    <Chart type="line" :data="chartData" :options="chartOptions" :pt="chartPassThrough" class="h-80" />
                    <table class="sr-only">
                        <caption>
                            최근 6개월 매출 및 매입. 단위 백만원
                        </caption>
                        <thead>
                            <tr>
                                <th scope="col">월</th>
                                <th scope="col">매출</th>
                                <th scope="col">매입</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(label, index) in financeTrend.labels" :key="label">
                                <th scope="row">{{ label }}</th>
                                <td>{{ financeTrend.sales[index] }}</td>
                                <td>{{ financeTrend.purchases[index] }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="col-span-12 xl:col-span-5">
                <div class="card h-full mb-0">
                    <h2 class="mb-6 text-xl font-semibold">최근 회계 항목</h2>
                    <DataTable :value="financeRows" dataKey="reference" responsiveLayout="scroll" tableStyle="min-width: 38rem" :tableProps="{ 'aria-label': '최근 회계 항목 목록' }" :rows="5">
                        <Column field="account" header="계정" />
                        <Column field="partner" header="거래처" />
                        <Column field="amount" header="금액">
                            <template #body="slotProps"
                                ><span class="font-medium">{{ formatWon(slotProps.data.amount) }}</span></template
                            >
                        </Column>
                        <Column field="status" header="상태">
                            <template #body="slotProps"><Tag :value="slotProps.data.status" :severity="statusSeverity(slotProps.data.status)" /></template>
                        </Column>
                    </DataTable>
                </div>
            </div>
        </div>
    </div>
</template>
