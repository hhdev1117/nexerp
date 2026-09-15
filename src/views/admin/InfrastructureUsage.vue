<script setup>
import { useAdminApi } from '@/services/adminApi';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const adminApi = useAdminApi();
const rangeOptions = Object.freeze([
    { label: '24시간', value: '24h' },
    { label: '7일', value: '7d' }
]);
const stateMeta = Object.freeze({
    ok: { label: '정상', severity: 'success' },
    partial: { label: '일부 확인', severity: 'warn' },
    unconfigured: { label: '설정 필요', severity: 'secondary' },
    unavailable: { label: '연결 실패', severity: 'danger' }
});
const issueLabels = Object.freeze({
    missing_configuration: '연결 설정이 완료되지 않았습니다.',
    provider_auth_failed: '제공자 인증을 확인해 주세요.',
    provider_forbidden: '조회 권한을 확인해 주세요.',
    provider_rate_limited: '요청 제한으로 잠시 조회할 수 없습니다.',
    provider_unavailable: '제공자 서비스에 연결할 수 없습니다.',
    provider_invalid_response: '제공자 응답을 확인할 수 없습니다.',
    metric_unavailable: '일부 지표를 확인할 수 없습니다.'
});

const selectedRange = ref('24h');
const usage = ref(null);
const loading = ref(true);
const loadError = ref(false);
const refreshCoolingDown = ref(false);
const refreshDisabled = computed(() => loading.value || refreshCoolingDown.value);
let requestSequence = 0;
let refreshTimer;

const supabase = computed(() => usage.value?.providers?.supabase || null);
const cloudflare = computed(() => usage.value?.providers?.cloudflare || null);

const providerMeta = (provider) => stateMeta[provider?.state] || stateMeta.unavailable;
const hasValue = (value) => value !== null && value !== undefined;
const formatMetric = (value, suffix = '') => {
    return `${Number(value).toLocaleString('ko-KR')}${suffix}`;
};
const formatDurationUs = (value) => {
    return `${(value / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 3 })} ms`;
};
const formatBytes = (value) => {
    if (value < 1024) return `${value.toLocaleString('ko-KR')} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let amount = value;
    let unitIndex = -1;
    while (amount >= 1024 && unitIndex < units.length - 1) {
        amount /= 1024;
        unitIndex += 1;
    }
    return `${amount.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
};
const formatTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '시각 정보 없음' : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Seoul' }).format(date);
};
const issueText = (issue) => issueLabels[issue] || issueLabels.metric_unavailable;
const visibleIssues = (provider) => (provider?.issues || []).filter((issue) => issue !== 'metric_unavailable' || provider.issues.length === 1);
const statusLabels = Object.freeze({
    ACTIVE_HEALTHY: '정상',
    ACTIVE_UNHEALTHY: '장애',
    COMING_UP: '시작 중',
    GOING_DOWN: '종료 중',
    INACTIVE: '중지',
    HEALTHY: '정상',
    UNHEALTHY: '장애',
    UNKNOWN: '상태 미확인',
    success: '성공',
    clientDisconnected: '클라이언트 연결 종료',
    scriptThrewException: '스크립트 예외',
    exceededResources: '리소스 초과',
    internalError: '내부 오류'
});
const statusLabel = (status) => statusLabels[status] || status;

async function loadUsage() {
    const requestId = ++requestSequence;
    const requestedRange = selectedRange.value;
    loading.value = true;
    loadError.value = false;
    try {
        const result = await adminApi.getInfrastructureUsage(requestedRange);
        if (requestId !== requestSequence || requestedRange !== selectedRange.value) return;
        usage.value = result;
    } catch {
        if (requestId !== requestSequence) return;
        usage.value = null;
        loadError.value = true;
    } finally {
        if (requestId === requestSequence) loading.value = false;
    }
}

function refreshUsage() {
    if (refreshDisabled.value) return;
    refreshCoolingDown.value = true;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshCoolingDown.value = false;
    }, 60_000);
    loadUsage();
}

watch(selectedRange, loadUsage);
onMounted(loadUsage);
onBeforeUnmount(() => clearTimeout(refreshTimer));
</script>

<template>
    <div class="min-w-0">
        <div class="flex flex-col gap-4 mb-6 md:flex-row md:items-end md:justify-between">
            <div class="min-w-0">
                <h1 class="text-2xl font-semibold text-surface-900 dark:text-surface-0">인프라 사용량</h1>
                <div class="mt-1 text-muted-color">Supabase와 Cloudflare의 운영 상태를 한곳에서 확인합니다.</div>
            </div>
            <div class="flex items-center gap-3 shrink-0">
                <SelectButton v-model="selectedRange" :options="rangeOptions" optionLabel="label" optionValue="value" :allowEmpty="false" aria-label="조회 기간" />
                <Button icon="pi pi-refresh" severity="secondary" outlined rounded aria-label="인프라 사용량 새로고침" :loading="loading" :disabled="refreshDisabled" @click="refreshUsage" />
            </div>
        </div>

        <div v-if="loading && !usage" class="card admin-state" role="status" aria-live="polite">
            <ProgressSpinner class="state-spinner" strokeWidth="5" />
            <span>인프라 사용량을 불러오는 중입니다.</span>
        </div>

        <div v-else-if="loadError" class="card admin-state" role="alert">
            <i class="pi pi-exclamation-circle text-2xl text-red-600" aria-hidden="true"></i>
            <strong>인프라 사용량을 불러오지 못했습니다.</strong>
            <span>잠시 후 다시 시도해 주세요.</span>
            <Button label="인프라 사용량 다시 불러오기" icon="pi pi-refresh" severity="secondary" outlined @click="loadUsage" />
        </div>

        <template v-else-if="usage">
            <div class="flex items-center gap-2 mb-4 text-sm md:justify-end text-muted-color" role="status">
                <i class="pi pi-clock" aria-hidden="true"></i>
                <span>생성 시각 {{ formatTime(usage.generatedAt) }}</span>
            </div>

            <section class="min-w-0 card" aria-labelledby="supabase-heading">
                <div class="flex items-center justify-between gap-4 mb-4">
                    <div>
                        <span class="block mb-1 text-xs font-semibold text-muted-color">데이터 및 인증</span>
                        <h2 id="supabase-heading" class="m-0 text-xl font-semibold text-surface-900 dark:text-surface-0">Supabase</h2>
                    </div>
                    <Tag :value="providerMeta(supabase).label" :severity="providerMeta(supabase).severity" />
                </div>

                <div
                    v-if="visibleIssues(supabase).length"
                    class="flex flex-wrap gap-x-5 gap-y-2 p-3 mb-4 text-sm border rounded-border border-yellow-300 bg-yellow-50 dark:border-yellow-500/40 dark:bg-yellow-400/10 text-surface-700 dark:text-surface-200"
                    role="status"
                >
                    <span v-for="issue in visibleIssues(supabase)" :key="issue" class="inline-flex items-center gap-2"><i class="pi pi-info-circle" aria-hidden="true"></i>{{ issueText(issue) }}</span>
                </div>

                <div class="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
                    <div v-if="hasValue(supabase?.database?.sizeBytes) && hasValue(supabase?.database?.limitBytes)" class="metric-tile [grid-column:1/-1]">
                        <span>데이터베이스 크기 / 무료 한도</span><strong>{{ formatBytes(supabase?.database?.sizeBytes) }} / {{ formatBytes(supabase?.database?.limitBytes) }}</strong>
                    </div>
                    <div v-if="hasValue(supabase?.database?.usagePercent)" class="metric-tile">
                        <span>사용률</span><strong>{{ formatMetric(supabase?.database?.usagePercent, '%') }}</strong>
                    </div>
                    <div v-if="hasValue(supabase?.usage?.totalRequests)" class="metric-tile">
                        <span>전체 API 요청</span><strong>{{ formatMetric(supabase?.usage?.totalRequests) }}</strong>
                    </div>
                    <div v-if="hasValue(supabase?.usage?.authRequests)" class="metric-tile">
                        <span>Auth 요청</span><strong>{{ formatMetric(supabase?.usage?.authRequests) }}</strong>
                    </div>
                    <div v-if="hasValue(supabase?.usage?.restRequests)" class="metric-tile">
                        <span>REST 요청</span><strong>{{ formatMetric(supabase?.usage?.restRequests) }}</strong>
                    </div>
                    <div v-if="hasValue(supabase?.usage?.realtimeRequests)" class="metric-tile">
                        <span>Realtime 요청</span><strong>{{ formatMetric(supabase?.usage?.realtimeRequests) }}</strong>
                    </div>
                    <div v-if="hasValue(supabase?.usage?.storageRequests)" class="metric-tile">
                        <span>Storage 요청</span><strong>{{ formatMetric(supabase?.usage?.storageRequests) }}</strong>
                    </div>
                </div>
                <p
                    v-if="!supabase?.project && !supabase?.disk && !supabase?.services?.length && !supabase?.usage && !hasValue(supabase?.database?.sizeBytes)"
                    class="p-5 m-0 text-center border border-dashed rounded-border border-surface-300 dark:border-surface-600 text-muted-color"
                >
                    연결 정보가 준비되면 사용량과 운영 상태가 여기에 표시됩니다.
                </p>

                <div v-if="supabase?.project || supabase?.disk || supabase?.services?.length" class="grid grid-cols-12 gap-6 mt-6">
                    <div v-if="supabase?.project || supabase?.disk" class="min-w-0 col-span-12 lg:col-span-5">
                        <h3 class="mt-0 mb-3 text-base font-semibold">프로젝트</h3>
                        <dl class="m-0">
                            <div v-if="supabase?.project?.status" class="detail-row">
                                <dt>상태</dt>
                                <dd>{{ statusLabel(supabase.project.status) }}</dd>
                            </div>
                            <div v-if="supabase?.project?.region" class="detail-row">
                                <dt>리전</dt>
                                <dd>{{ supabase.project.region }}</dd>
                            </div>
                            <div v-if="hasValue(supabase?.disk?.provisionedSizeGb)" class="detail-row">
                                <dt>할당 디스크</dt>
                                <dd>{{ formatMetric(supabase?.disk?.provisionedSizeGb, ' GB') }}</dd>
                            </div>
                            <div v-if="hasValue(supabase?.disk?.usedBytes)" class="detail-row">
                                <dt>전체 디스크(데이터베이스+WAL+시스템)</dt>
                                <dd>{{ formatBytes(supabase?.disk?.usedBytes) }}</dd>
                            </div>
                            <div v-if="hasValue(supabase?.disk?.availableBytes)" class="detail-row">
                                <dt>가용 공간</dt>
                                <dd>{{ formatBytes(supabase?.disk?.availableBytes) }}</dd>
                            </div>
                        </dl>
                    </div>
                    <div v-if="supabase?.services?.length" class="min-w-0 col-span-12 lg:col-span-7">
                        <h3 class="mt-0 mb-3 text-base font-semibold">서비스 상태</h3>
                        <DataTable :value="supabase.services" dataKey="name" size="small" responsiveLayout="scroll" tableStyle="min-width: 22rem" :tableProps="{ 'aria-label': 'Supabase 서비스 상태' }">
                            <Column field="name" header="서비스" />
                            <Column header="상태">
                                <template #body="slotProps">
                                    <Tag :value="slotProps.data.healthy ? '정상' : '확인 필요'" :severity="slotProps.data.healthy ? 'success' : 'warn'" />
                                </template>
                            </Column>
                        </DataTable>
                    </div>
                </div>
            </section>

            <section class="min-w-0 card" aria-labelledby="cloudflare-heading">
                <div class="flex items-center justify-between gap-4 mb-4">
                    <div>
                        <span class="block mb-1 text-xs font-semibold text-muted-color">애플리케이션 실행</span>
                        <h2 id="cloudflare-heading" class="m-0 text-xl font-semibold text-surface-900 dark:text-surface-0">Cloudflare Workers</h2>
                    </div>
                    <Tag :value="providerMeta(cloudflare).label" :severity="providerMeta(cloudflare).severity" />
                </div>

                <div
                    v-if="visibleIssues(cloudflare).length"
                    class="flex flex-wrap gap-x-5 gap-y-2 p-3 mb-4 text-sm border rounded-border border-yellow-300 bg-yellow-50 dark:border-yellow-500/40 dark:bg-yellow-400/10 text-surface-700 dark:text-surface-200"
                    role="status"
                >
                    <span v-for="issue in visibleIssues(cloudflare)" :key="issue" class="inline-flex items-center gap-2"><i class="pi pi-info-circle" aria-hidden="true"></i>{{ issueText(issue) }}</span>
                </div>

                <div v-if="hasValue(cloudflare?.requests) || hasValue(cloudflare?.cpuTimeUs?.p50)" class="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
                    <div v-if="hasValue(cloudflare?.requests)" class="metric-tile">
                        <span>요청</span><strong>{{ formatMetric(cloudflare?.requests) }}</strong>
                    </div>
                    <div v-if="hasValue(cloudflare?.errors)" class="metric-tile">
                        <span>오류</span><strong>{{ formatMetric(cloudflare?.errors) }}</strong>
                    </div>
                    <div v-if="hasValue(cloudflare?.errorRate)" class="metric-tile">
                        <span>오류율</span><strong>{{ formatMetric(cloudflare?.errorRate, '%') }}</strong>
                    </div>
                    <div v-if="hasValue(cloudflare?.subrequests)" class="metric-tile">
                        <span>서브요청</span><strong>{{ formatMetric(cloudflare?.subrequests) }}</strong>
                    </div>
                    <div v-if="hasValue(cloudflare?.cpuTimeUs?.p50)" class="metric-tile">
                        <span>CPU P50</span><strong>{{ formatDurationUs(cloudflare?.cpuTimeUs?.p50) }}</strong>
                    </div>
                    <div v-if="hasValue(cloudflare?.cpuTimeUs?.p99)" class="metric-tile">
                        <span>CPU P99</span><strong>{{ formatDurationUs(cloudflare?.cpuTimeUs?.p99) }}</strong>
                    </div>
                </div>
                <p v-else class="p-5 m-0 text-center border border-dashed rounded-border border-surface-300 dark:border-surface-600 text-muted-color">Cloudflare API 토큰을 연결하면 요청량과 실행 상태가 여기에 표시됩니다.</p>

                <p v-if="hasValue(cloudflare?.requests)" class="mt-3 mb-0 text-xs text-muted-color">Cloudflare Analytics는 샘플링 기반 운영 지표이며 청구 사용량과 다를 수 있습니다.</p>
                <p v-if="cloudflare?.seriesComplete === false" class="py-3 mt-4 mb-0 text-sm border-t border-b border-surface-200 dark:border-surface-700 text-muted-color" role="status">수집 한도에 도달해 상세 이력을 표시할 수 없습니다.</p>

                <div v-if="cloudflare?.byStatus?.length || cloudflare?.settings" class="grid grid-cols-12 gap-6 mt-6">
                    <div v-if="cloudflare?.seriesComplete !== false" class="min-w-0 col-span-12 lg:col-span-7">
                        <h3 class="mt-0 mb-3 text-base font-semibold">상태별 호출</h3>
                        <DataTable v-if="cloudflare?.byStatus?.length" :value="cloudflare.byStatus" dataKey="status" size="small" responsiveLayout="scroll" tableStyle="min-width: 28rem" :tableProps="{ 'aria-label': '상태별 호출' }">
                            <Column header="상태">
                                <template #body="slotProps">{{ statusLabel(slotProps.data.status) }}</template>
                            </Column>
                            <Column header="요청" headerClass="num-col" bodyClass="num-col">
                                <template #body="slotProps">{{ formatMetric(slotProps.data.requests) }}</template>
                            </Column>
                            <Column header="오류" headerClass="num-col" bodyClass="num-col">
                                <template #body="slotProps">{{ formatMetric(slotProps.data.errors) }}</template>
                            </Column>
                            <Column header="서브요청" headerClass="num-col" bodyClass="num-col">
                                <template #body="slotProps">{{ formatMetric(slotProps.data.subrequests) }}</template>
                            </Column>
                        </DataTable>
                        <p v-else class="min-h-16 py-4 m-0 text-center text-muted-color">확인 가능한 상태별 호출이 없습니다.</p>
                    </div>
                    <div v-if="cloudflare?.settings" class="min-w-0 col-span-12 lg:col-span-5">
                        <h3 class="mt-0 mb-3 text-base font-semibold">실행 설정</h3>
                        <dl class="m-0">
                            <div v-if="cloudflare?.settings?.usageModel" class="detail-row">
                                <dt>사용 모델</dt>
                                <dd>{{ cloudflare.settings.usageModel }}</dd>
                            </div>
                            <div v-if="hasValue(cloudflare?.settings?.cpuMs)" class="detail-row">
                                <dt>CPU 제한</dt>
                                <dd>{{ formatMetric(cloudflare?.settings?.cpuMs, ' ms') }}</dd>
                            </div>
                            <div v-if="hasValue(cloudflare?.settings?.subrequests)" class="detail-row">
                                <dt>서브요청 제한</dt>
                                <dd>{{ formatMetric(cloudflare?.settings?.subrequests) }}</dd>
                            </div>
                        </dl>
                    </div>
                </div>

                <div v-if="cloudflare?.seriesComplete !== null && cloudflare?.seriesComplete !== false" class="min-w-0 mt-6">
                    <h3 class="mt-0 mb-3 text-base font-semibold">시간별 운영 이력</h3>
                    <DataTable
                        v-if="cloudflare?.series?.length"
                        :value="cloudflare.series"
                        :dataKey="(row) => row.datetime + '-' + row.status"
                        size="small"
                        stripedRows
                        responsiveLayout="scroll"
                        tableStyle="min-width: 34rem"
                        :tableProps="{ 'aria-label': '시간별 운영 이력' }"
                    >
                        <Column header="시각">
                            <template #body="slotProps">{{ formatTime(slotProps.data.datetime) }}</template>
                        </Column>
                        <Column header="상태">
                            <template #body="slotProps">{{ statusLabel(slotProps.data.status) }}</template>
                        </Column>
                        <Column header="요청" headerClass="num-col" bodyClass="num-col">
                            <template #body="slotProps">{{ formatMetric(slotProps.data.requests) }}</template>
                        </Column>
                        <Column header="오류" headerClass="num-col" bodyClass="num-col">
                            <template #body="slotProps">{{ formatMetric(slotProps.data.errors) }}</template>
                        </Column>
                        <Column header="서브요청" headerClass="num-col" bodyClass="num-col">
                            <template #body="slotProps">{{ formatMetric(slotProps.data.subrequests) }}</template>
                        </Column>
                    </DataTable>
                    <div v-else class="flex flex-col items-center justify-center gap-2 py-8 text-center text-muted-color">
                        <span>조회된 호출 내역이 없습니다.</span>
                        <Button v-if="cloudflare?.state === 'unavailable'" label="인프라 사용량 다시 불러오기" icon="pi pi-refresh" severity="secondary" text @click="loadUsage" />
                    </div>
                </div>
            </section>
        </template>
    </div>
</template>

<style scoped>
.metric-tile {
    min-height: 6.25rem;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem;
    background: var(--surface-ground);
    border: 1px solid var(--surface-border);
    border-radius: var(--content-border-radius);
}

.metric-tile span {
    color: var(--text-color-secondary);
    font-size: 0.875rem;
}

.metric-tile strong {
    font-size: 1.35rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
}

.detail-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--surface-border);
}

.detail-row dt {
    color: var(--text-color-secondary);
    overflow-wrap: anywhere;
}

.detail-row dd {
    margin: 0;
    font-weight: 600;
    text-align: right;
}

@media (max-width: 760px) {
    .detail-row {
        align-items: flex-start;
        flex-direction: column;
        gap: 0.25rem;
    }

    .detail-row dd {
        text-align: left;
    }
}
</style>
