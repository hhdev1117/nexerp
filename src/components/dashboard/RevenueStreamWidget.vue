<script setup>
import { useLayout } from '@/layout/composables/layout';
import { computed, onMounted, ref, watch } from 'vue';

const props = defineProps({
    trend: {
        type: Object,
        required: true
    }
});

const { layoutConfig, isDarkTheme } = useLayout();
const chartData = ref(null);
const chartOptions = ref(null);
const profitTrend = computed(() => props.trend.sales.map((value, index) => value - props.trend.purchases[index]));
const chartPassThrough = {
    canvas: {
        role: 'img',
        'aria-label': '최근 6개월 월별 매출, 매입 및 매출총이익 추이 차트. 상세 수치는 이어지는 데이터 표를 참조하세요.'
    }
};

function cssColor(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function setChartData() {
    return {
        labels: props.trend.labels,
        datasets: [
            {
                type: 'bar',
                label: '매출',
                backgroundColor: cssColor('--p-primary-400', '#34d399'),
                borderRadius: 6,
                data: props.trend.sales,
                barPercentage: 0.72,
                categoryPercentage: 0.7
            },
            {
                type: 'bar',
                label: '매입',
                backgroundColor: cssColor('--p-primary-200', '#a7f3d0'),
                borderRadius: 6,
                data: props.trend.purchases,
                barPercentage: 0.72,
                categoryPercentage: 0.7
            },
            {
                type: 'line',
                label: '매출총이익',
                borderColor: cssColor('--p-cyan-500', '#06b6d4'),
                backgroundColor: cssColor('--p-cyan-500', '#06b6d4'),
                data: profitTrend.value,
                borderWidth: 2,
                pointRadius: 3,
                pointHoverRadius: 5,
                tension: 0.4
            }
        ]
    };
}

function setChartOptions() {
    const borderColor = cssColor('--surface-border', '#e2e8f0');
    const textColor = cssColor('--text-color', '#334155');
    const textMutedColor = cssColor('--text-color-secondary', '#64748b');

    return {
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false
        },
        plugins: {
            legend: {
                labels: {
                    color: textColor,
                    usePointStyle: true,
                    boxWidth: 8
                }
            },
            tooltip: {
                callbacks: {
                    label: (context) => `${context.dataset.label}: ${Number(context.raw).toLocaleString('ko-KR')}백만원`
                }
            }
        },
        scales: {
            x: {
                ticks: { color: textMutedColor },
                grid: { color: 'transparent' }
            },
            y: {
                beginAtZero: true,
                ticks: {
                    color: textMutedColor,
                    callback: (value) => `${value}M`
                },
                grid: {
                    color: borderColor,
                    drawTicks: false
                }
            }
        }
    };
}

function refreshChart() {
    chartData.value = setChartData();
    chartOptions.value = setChartOptions();
}

watch([() => props.trend, () => layoutConfig.primary, () => layoutConfig.surface, isDarkTheme], refreshChart, { deep: true });
onMounted(refreshChart);
</script>

<template>
    <div class="card">
        <h2 class="font-semibold text-xl">매출 · 매입 추이</h2>
        <div class="mt-1 mb-4 text-sm text-muted-color">단위: 백만원</div>
        <Chart type="bar" :data="chartData" :options="chartOptions" :pt="chartPassThrough" class="h-80" />
        <table class="sr-only">
            <caption>
                최근 6개월 매출, 매입 및 매출총이익. 단위 백만원
            </caption>
            <thead>
                <tr>
                    <th scope="col">월</th>
                    <th scope="col">매출</th>
                    <th scope="col">매입</th>
                    <th scope="col">매출총이익</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(label, index) in trend.labels" :key="label">
                    <th scope="row">{{ label }}</th>
                    <td>{{ trend.sales[index] }}</td>
                    <td>{{ trend.purchases[index] }}</td>
                    <td>{{ profitTrend[index] }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
