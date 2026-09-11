<script setup>
import BestSellingWidget from '@/components/dashboard/BestSellingWidget.vue';
import NotificationsWidget from '@/components/dashboard/NotificationsWidget.vue';
import RecentSalesWidget from '@/components/dashboard/RecentSalesWidget.vue';
import RevenueStreamWidget from '@/components/dashboard/RevenueStreamWidget.vue';
import StatsWidget from '@/components/dashboard/StatsWidget.vue';
import { getDashboardSnapshot } from '@/data/erp';
import { computed, reactive } from 'vue';

const companies = ['전체 회사', '넥서스 제조', '넥서스 유통'];
const sites = ['전체 사업장', '서울 본사', '인천 공장', '부산 물류센터'];
const periods = ['이번 주', '이번 달', '이번 분기'];

const filters = reactive({
    company: '전체 회사',
    site: '전체 사업장',
    period: '이번 달'
});

const snapshot = computed(() => getDashboardSnapshot(filters));
</script>

<template>
    <div class="grid grid-cols-12 gap-8">
        <div class="col-span-12">
            <div class="card mb-0">
                <div class="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                        <h1 class="font-semibold text-2xl text-surface-900 dark:text-surface-0">통합 대시보드</h1>
                        <div class="mt-2 text-muted-color">전사 영업, 구매, 재고 및 재무 현황을 한눈에 확인합니다.</div>
                    </div>
                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:min-w-[42rem]">
                        <div class="flex flex-col gap-2">
                            <label for="dashboard-company" class="text-sm font-medium text-muted-color">회사</label>
                            <Select inputId="dashboard-company" v-model="filters.company" :options="companies" fluid aria-label="회사 선택" />
                        </div>
                        <div class="flex flex-col gap-2">
                            <label for="dashboard-site" class="text-sm font-medium text-muted-color">사업장</label>
                            <Select inputId="dashboard-site" v-model="filters.site" :options="sites" fluid aria-label="사업장 선택" />
                        </div>
                        <div class="flex flex-col gap-2">
                            <label for="dashboard-period" class="text-sm font-medium text-muted-color">조회 기간</label>
                            <Select inputId="dashboard-period" v-model="filters.period" :options="periods" fluid aria-label="조회 기간 선택" />
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <StatsWidget :metrics="snapshot.metrics" />

        <div class="col-span-12 xl:col-span-6">
            <RecentSalesWidget />
            <BestSellingWidget />
        </div>
        <div class="col-span-12 xl:col-span-6">
            <RevenueStreamWidget :trend="snapshot.trend" />
            <NotificationsWidget />
        </div>
    </div>
</template>
