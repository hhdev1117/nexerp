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
const formatMetric = (value, suffix = '') => {
    return value === null || value === undefined ? '확인 불가' : `${Number(value).toLocaleString('ko-KR')}${suffix}`;
};
const formatDurationUs = (value) => {
    return value === null || value === undefined ? '확인 불가' : `${(value / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 3 })} ms`;
};
const formatBytes = (value) => {
    if (value === null || value === undefined) return '확인 불가';
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
    return Number.isNaN(date.getTime()) ? '확인 불가' : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Seoul' }).format(date);
};
const issueText = (issue) => issueLabels[issue] || issueLabels.metric_unavailable;

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
    <main class="usage-page">
        <header class="page-header">
            <div class="min-w-0">
                <h1>인프라 사용량</h1>
                <p>Supabase와 Cloudflare의 운영 상태를 한곳에서 확인합니다.</p>
            </div>
            <div class="page-actions">
                <SelectButton v-model="selectedRange" :options="rangeOptions" optionLabel="label" optionValue="value" :allowEmpty="false" aria-label="조회 기간" />
                <Button icon="pi pi-refresh" severity="secondary" outlined rounded aria-label="인프라 사용량 새로고침" :loading="loading" :disabled="refreshDisabled" @click="refreshUsage" />
            </div>
        </header>

        <div v-if="loading && !usage" class="page-state" role="status" aria-live="polite">
            <ProgressSpinner class="state-spinner" strokeWidth="5" />
            <span>인프라 사용량을 불러오는 중입니다.</span>
        </div>

        <div v-else-if="loadError" class="page-state" role="alert">
            <i class="pi pi-exclamation-circle text-2xl text-red-600" aria-hidden="true"></i>
            <strong>인프라 사용량을 불러오지 못했습니다.</strong>
            <span>잠시 후 다시 시도해 주세요.</span>
            <Button label="인프라 사용량 다시 불러오기" icon="pi pi-refresh" severity="secondary" outlined @click="loadUsage" />
        </div>

        <template v-else-if="usage">
            <div class="generated-time" role="status">
                <i class="pi pi-clock" aria-hidden="true"></i>
                <span>생성 시각 {{ formatTime(usage.generatedAt) }}</span>
            </div>

            <section class="provider-section" aria-labelledby="supabase-heading">
                <div class="section-heading">
                    <div>
                        <span class="provider-kicker">데이터 및 인증</span>
                        <h2 id="supabase-heading">Supabase</h2>
                    </div>
                    <Tag :value="providerMeta(supabase).label" :severity="providerMeta(supabase).severity" />
                </div>

                <div v-if="supabase?.issues?.length" class="issue-strip" role="status">
                    <span v-for="issue in supabase.issues" :key="issue"><i class="pi pi-info-circle" aria-hidden="true"></i>{{ issueText(issue) }}</span>
                </div>

                <div class="metric-grid">
                    <div class="metric-tile database-metric">
                        <span>데이터베이스 크기 / 무료 한도</span><strong>{{ formatBytes(supabase?.database?.sizeBytes) }} / {{ formatBytes(supabase?.database?.limitBytes) }}</strong>
                    </div>
                    <div class="metric-tile">
                        <span>사용률</span><strong>{{ formatMetric(supabase?.database?.usagePercent, '%') }}</strong>
                    </div>
                    <div class="metric-tile">
                        <span>전체 API 요청</span><strong>{{ formatMetric(supabase?.usage?.totalRequests) }}</strong>
                    </div>
                    <div class="metric-tile">
                        <span>Auth 요청</span><strong>{{ formatMetric(supabase?.usage?.authRequests) }}</strong>
                    </div>
                    <div class="metric-tile">
                        <span>REST 요청</span><strong>{{ formatMetric(supabase?.usage?.restRequests) }}</strong>
                    </div>
                    <div class="metric-tile">
                        <span>Realtime 요청</span><strong>{{ formatMetric(supabase?.usage?.realtimeRequests) }}</strong>
                    </div>
                    <div class="metric-tile">
                        <span>Storage 요청</span><strong>{{ formatMetric(supabase?.usage?.storageRequests) }}</strong>
                    </div>
                </div>

                <div class="details-grid">
                    <div class="detail-block">
                        <h3>프로젝트</h3>
                        <dl>
                            <div>
                                <dt>상태</dt>
                                <dd>{{ supabase?.project?.status || '확인 불가' }}</dd>
                            </div>
                            <div>
                                <dt>리전</dt>
                                <dd>{{ supabase?.project?.region || '확인 불가' }}</dd>
                            </div>
                            <div>
                                <dt>할당 디스크</dt>
                                <dd>{{ formatMetric(supabase?.disk?.provisionedSizeGb, ' GB') }}</dd>
                            </div>
                            <div>
                                <dt>전체 디스크(데이터베이스+WAL+시스템)</dt>
                                <dd>{{ formatBytes(supabase?.disk?.usedBytes) }}</dd>
                            </div>
                            <div>
                                <dt>가용 공간</dt>
                                <dd>{{ formatBytes(supabase?.disk?.availableBytes) }}</dd>
                            </div>
                        </dl>
                    </div>
                    <div class="detail-block service-block">
                        <h3>서비스 상태</h3>
                        <div v-if="supabase?.services?.length" class="table-scroll">
                            <table>
                                <thead>
                                    <tr>
                                        <th scope="col">서비스</th>
                                        <th scope="col">상태</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="service in supabase.services" :key="service.name">
                                        <td>{{ service.name }}</td>
                                        <td><Tag :value="service.healthy ? '정상' : '확인 필요'" :severity="service.healthy ? 'success' : 'warn'" /></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <p v-else class="empty-row">확인 가능한 서비스 상태가 없습니다.</p>
                    </div>
                </div>
            </section>

            <section class="provider-section" aria-labelledby="cloudflare-heading">
                <div class="section-heading">
                    <div>
                        <span class="provider-kicker">애플리케이션 실행</span>
                        <h2 id="cloudflare-heading">Cloudflare Workers</h2>
                    </div>
                    <Tag :value="providerMeta(cloudflare).label" :severity="providerMeta(cloudflare).severity" />
                </div>

                <div v-if="cloudflare?.issues?.length" class="issue-strip" role="status">
                    <span v-for="issue in cloudflare.issues" :key="issue"><i class="pi pi-info-circle" aria-hidden="true"></i>{{ issueText(issue) }}</span>
                </div>

                <div class="metric-grid">
                    <div class="metric-tile">
                        <span>요청</span><strong>{{ formatMetric(cloudflare?.requests) }}</strong>
                    </div>
                    <div class="metric-tile">
                        <span>오류</span><strong>{{ formatMetric(cloudflare?.errors) }}</strong>
                    </div>
                    <div class="metric-tile">
                        <span>오류율</span><strong>{{ formatMetric(cloudflare?.errorRate, '%') }}</strong>
                    </div>
                    <div class="metric-tile">
                        <span>서브요청</span><strong>{{ formatMetric(cloudflare?.subrequests) }}</strong>
                    </div>
                    <div class="metric-tile">
                        <span>CPU P50</span><strong>{{ formatDurationUs(cloudflare?.cpuTimeUs?.p50) }}</strong>
                    </div>
                    <div class="metric-tile">
                        <span>CPU P99</span><strong>{{ formatDurationUs(cloudflare?.cpuTimeUs?.p99) }}</strong>
                    </div>
                    <div class="metric-tile">
                        <span>응답 바이트</span><strong>{{ cloudflare?.responseBytes === null ? '제공 안 됨' : formatBytes(cloudflare?.responseBytes) }}</strong>
                    </div>
                </div>

                <p class="analytics-note">Cloudflare Analytics는 샘플링 기반 운영 지표이며 청구 사용량과 다를 수 있습니다.</p>
                <p v-if="cloudflare?.seriesComplete === false" class="detail-limit" role="status">수집 한도에 도달해 상세 이력을 표시할 수 없습니다.</p>

                <div class="details-grid cloudflare-details" :class="{ 'detail-only': cloudflare?.seriesComplete === false }">
                    <div v-if="cloudflare?.seriesComplete !== false" class="detail-block">
                        <h3>상태별 호출</h3>
                        <div v-if="cloudflare?.byStatus?.length" class="table-scroll">
                            <table>
                                <thead>
                                    <tr>
                                        <th scope="col">상태</th>
                                        <th scope="col">요청</th>
                                        <th scope="col">오류</th>
                                        <th scope="col">서브요청</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="row in cloudflare.byStatus" :key="row.status">
                                        <td>{{ row.status }}</td>
                                        <td>{{ formatMetric(row.requests) }}</td>
                                        <td>{{ formatMetric(row.errors) }}</td>
                                        <td>{{ formatMetric(row.subrequests) }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <p v-else class="empty-row compact-empty">확인 가능한 상태별 호출이 없습니다.</p>
                    </div>
                    <div class="detail-block">
                        <h3>실행 설정</h3>
                        <dl>
                            <div>
                                <dt>사용 모델</dt>
                                <dd>{{ cloudflare?.settings?.usageModel || '확인 불가' }}</dd>
                            </div>
                            <div>
                                <dt>CPU 제한</dt>
                                <dd>{{ formatMetric(cloudflare?.settings?.cpuMs, ' ms') }}</dd>
                            </div>
                            <div>
                                <dt>서브요청 제한</dt>
                                <dd>{{ formatMetric(cloudflare?.settings?.subrequests) }}</dd>
                            </div>
                        </dl>
                    </div>
                </div>

                <div v-if="cloudflare?.seriesComplete !== false" class="detail-block invocation-block">
                    <h3>시간별 운영 이력</h3>
                    <div v-if="cloudflare?.series?.length" class="table-scroll">
                        <table>
                            <thead>
                                <tr>
                                    <th scope="col">시각</th>
                                    <th scope="col">상태</th>
                                    <th scope="col">요청</th>
                                    <th scope="col">오류</th>
                                    <th scope="col">서브요청</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="row in cloudflare.series" :key="`${row.datetime}-${row.status}`">
                                    <td>{{ formatTime(row.datetime) }}</td>
                                    <td>{{ row.status }}</td>
                                    <td>{{ formatMetric(row.requests) }}</td>
                                    <td>{{ formatMetric(row.errors) }}</td>
                                    <td>{{ formatMetric(row.subrequests) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div v-else class="empty-row">
                        <span>조회된 호출 내역이 없습니다.</span>
                        <Button v-if="cloudflare?.state === 'unavailable'" label="인프라 사용량 다시 불러오기" icon="pi pi-refresh" severity="secondary" text @click="loadUsage" />
                    </div>
                </div>
            </section>
        </template>
    </main>
</template>

<style scoped>
.usage-page,
.page-header,
.provider-section,
.details-grid,
.detail-block {
    min-width: 0;
}

.usage-page {
    width: 100%;
}

.page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 1.5rem;
    border-bottom: 1px solid var(--surface-border);
}

.page-header h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
}

.page-header p {
    margin: 0.35rem 0 0;
    color: var(--text-color-secondary);
}

.page-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
}

.page-state {
    min-height: 25rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.8rem;
    padding: 2rem;
    color: var(--text-color-secondary);
    text-align: center;
}

.state-spinner {
    width: 2.5rem;
    height: 2.5rem;
}

.generated-time {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.8rem 1.5rem 0;
    color: var(--text-color-secondary);
    font-size: 0.875rem;
}

.provider-section {
    width: 100%;
    padding: 1.5rem;
    background: var(--surface-card);
    border-top: 1px solid var(--surface-border);
    border-bottom: 1px solid var(--surface-border);
}

.provider-section:last-child {
    border-bottom: 0;
}

.section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
}

.provider-kicker {
    display: block;
    margin-bottom: 0.2rem;
    color: var(--text-color-secondary);
    font-size: 0.75rem;
    font-weight: 600;
}

.section-heading h2 {
    margin: 0;
    font-size: 1.2rem;
}

.issue-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1.25rem;
    margin-bottom: 1rem;
    padding: 0.75rem 0;
    color: var(--text-color-secondary);
    font-size: 0.875rem;
}

.issue-strip span {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
}

.metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.75rem;
}

.metric-tile {
    min-height: 6.25rem;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem;
    background: var(--surface-ground);
    border: 1px solid var(--surface-border);
    border-radius: 6px;
}

.metric-tile span {
    color: var(--text-color-secondary);
    font-size: 0.875rem;
}

.metric-tile strong {
    font-size: 1.35rem;
    font-weight: 700;
}

.database-metric {
    grid-column: 1 / -1;
}

.details-grid {
    display: grid;
    grid-template-columns: minmax(15rem, 0.8fr) minmax(20rem, 1.2fr);
    gap: 1.5rem;
    margin-top: 1.5rem;
}

.detail-block h3 {
    margin: 0 0 0.75rem;
    font-size: 0.95rem;
}

.detail-block dl {
    margin: 0;
}

.detail-block dl div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--surface-border);
}

.detail-block dt {
    color: var(--text-color-secondary);
    overflow-wrap: anywhere;
}

.detail-block dd {
    margin: 0;
    font-weight: 600;
    text-align: right;
}

.invocation-block {
    margin-top: 1.5rem;
}

.analytics-note {
    margin: 0.85rem 0 0;
    color: var(--text-color-secondary);
    font-size: 0.8rem;
}

.detail-limit {
    margin: 1rem 0 0;
    padding: 0.8rem 0;
    border-block: 1px solid var(--surface-border);
    color: var(--text-color-secondary);
    font-size: 0.875rem;
}

.cloudflare-details {
    grid-template-columns: minmax(20rem, 1.35fr) minmax(14rem, 0.65fr);
}

.cloudflare-details.detail-only {
    grid-template-columns: minmax(0, 1fr);
}

.compact-empty {
    min-height: 4rem;
}

.table-scroll {
    max-width: 100%;
    overflow-x: auto;
}

table {
    width: 100%;
    min-width: 28rem;
    border-collapse: collapse;
}

th,
td {
    padding: 0.75rem;
    border-bottom: 1px solid var(--surface-border);
    text-align: left;
    white-space: nowrap;
}

th {
    color: var(--text-color-secondary);
    font-size: 0.75rem;
    font-weight: 600;
}

td {
    font-size: 0.875rem;
}

.empty-row {
    min-height: 6rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: var(--text-color-secondary);
    text-align: center;
}

@media (max-width: 760px) {
    .page-header {
        align-items: stretch;
        flex-direction: column;
    }

    .page-actions {
        justify-content: space-between;
    }

    .details-grid {
        grid-template-columns: minmax(0, 1fr);
    }

    .provider-section,
    .page-header {
        padding: 1.1rem;
    }

    .generated-time {
        justify-content: flex-start;
        padding-inline: 1.1rem;
    }
}
</style>
