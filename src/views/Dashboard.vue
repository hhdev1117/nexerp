<script setup>
import BestSellingWidget from '@/components/dashboard/BestSellingWidget.vue';
import NotificationsWidget from '@/components/dashboard/NotificationsWidget.vue';
import RecentSalesWidget from '@/components/dashboard/RecentSalesWidget.vue';
import RevenueStreamWidget from '@/components/dashboard/RevenueStreamWidget.vue';
import StatsWidget from '@/components/dashboard/StatsWidget.vue';
import { getDashboardSnapshot } from '@/data/erp';
import { useMasterStore } from '@/stores/master';
import { computed, reactive, watch } from 'vue';

const ALL_COMPANIES = '전체 회사';
const ALL_SITES = '전체 사업장';
const periods = ['이번 주', '이번 달', '이번 분기'];

const masterStore = useMasterStore();
masterStore.ensureLoaded();

const filters = reactive({
    company: ALL_COMPANIES,
    site: ALL_SITES,
    period: '이번 달'
});

// Filter options come from the registered companies and sites, so the dashboard follows the master data.
const companies = computed(() => [ALL_COMPANIES, ...masterStore.activeCompanies.value.map((company) => company.name)]);
const sites = computed(() => {
    const company = masterStore.activeCompanies.value.find((item) => item.name === filters.company);
    const visibleSites = company ? masterStore.sitesFor(company.id) : masterStore.sites.value;
    return [ALL_SITES, ...visibleSites.filter((site) => site.isActive).map((site) => site.name)];
});

watch(
    () => filters.company,
    () => {
        filters.site = ALL_SITES;
    }
);
watch(companies, (options) => {
    if (!options.includes(filters.company)) filters.company = ALL_COMPANIES;
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
