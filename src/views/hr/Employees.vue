<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useHrStore } from '@/stores/hr';
import { useAuthStore } from '@/stores/auth';
import { useEnterpriseRuntimeStore } from '@/stores/enterpriseRuntime';
const hr = useHrStore();
const auth = useAuthStore();
const runtime = useEnterpriseRuntimeStore();
const { directory, loading, saving, error } = hr;
const company = computed(() => (runtime.context.value?.mode === 'active' ? runtime.context.value.companyId : null));
const search = ref('');
const selectedId = ref(null);
const selected = computed(() => directory.value?.employees.find((item) => item.id === selectedId.value));
const dialog = ref(null);
const draft = ref({});
const reason = ref('');
const confirmed = ref(false);
const validation = ref('');
const cancelTarget = ref(null);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const statusLabel = (status) => ({ planned: '입사 예정', active: '재직', terminated: '퇴사' })[status] || status;
const siteName = (id) => directory.value?.sites.find((item) => item.id === id)?.name || (id ? '비활성 또는 미조회 사업장' : '미지정');
const actions = computed(() => [...(selected.value?.actions || [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)));
const latest = computed(() => actions.value.filter((item) => !item.cancelled).at(-1));
function close() {
    dialog.value = null;
    draft.value = {};
    reason.value = '';
    confirmed.value = false;
    validation.value = '';
    cancelTarget.value = null;
}
function load(page = 1) {
    if (company.value) return hr.load(company.value, search.value.trim(), page);
}
watch(
    () => [auth.user.value?.id, company.value],
    ([identity, id]) => {
        hr.reset();
        close();
        selectedId.value = null;
        search.value = '';
        if (identity && id) hr.load(id, '', 1);
    },
    { immediate: true, flush: 'sync' }
);
onBeforeUnmount(() => {
    hr.reset();
    close();
});
function register() {
    close();
    draft.value = { employeeNo: '', name: '', profileId: '', hireDate: today(), siteId: '', department: '', grade: '', position: '' };
    dialog.value = 'register';
}
function action() {
    close();
    draft.value = { type: 'transfer', effectiveDate: today(), siteId: selected.value.siteId || '', department: selected.value.department || '', grade: selected.value.grade || '', position: selected.value.position || '' };
    dialog.value = 'action';
}
function cancel(item) {
    close();
    cancelTarget.value = item;
    dialog.value = 'cancel';
}
async function save() {
    validation.value = '';
    if (saving.value || !company.value) return;
    if (!reason.value.trim()) {
        validation.value = '변경 사유를 입력해 주세요.';
        return;
    }
    if ((dialog.value === 'cancel' || draft.value.type === 'terminate') && !confirmed.value) {
        validation.value = '접근 권한에 미치는 영향을 확인해 주세요.';
        return;
    }
    const identity = auth.user.value?.id;
    const companyId = company.value;
    let success = false;
    if (dialog.value === 'register' && directory.value?.permissions.create) {
        success = await hr.createEmployee({ ...draft.value, profileId: draft.value.profileId.trim() || null, siteId: draft.value.siteId || null }, reason.value.trim());
    } else if (directory.value?.permissions.update && selected.value) {
        const employee = selected.value;
        success =
            dialog.value === 'cancel'
                ? await hr.cancelAction(employee.id, cancelTarget.value.id, employee.revision, reason.value.trim())
                : await hr.recordAction(employee.id, employee.revision, { ...draft.value, siteId: draft.value.siteId || null, reason: reason.value.trim() });
    }
    if (success && identity === auth.user.value?.id && companyId === company.value) {
        close();
        await runtime.refresh(identity, companyId);
    }
}
</script>

<template>
    <section class="hr-page" aria-labelledby="hr-title">
        <div class="card">
            <div class="hr-heading">
                <div>
                    <h1 id="hr-title" class="text-2xl font-semibold">직원 명부</h1>
                    <p class="text-muted-color mt-2">현재 회사의 직원과 날짜별 주 소속 발령을 관리합니다.</p>
                </div>
                <Button v-if="directory?.permissions.create" data-testid="register" label="직원 등록" icon="pi pi-user-plus" :disabled="loading || saving" @click="register" />
            </div>
            <p class="hr-note">로그인 계정 연결만으로 회사 접근 권한이 생기지 않습니다. 게시된 회사 멤버십이 별도로 필요하며, 직접 지정한 레벨과 개별 예외는 유지됩니다.</p>
            <form class="hr-search" @submit.prevent="load(1)">
                <label for="employee-search">직원 검색</label><input id="employee-search" v-model="search" type="search" maxlength="100" placeholder="사번 또는 이름" /><Button type="submit" label="검색" :disabled="loading || !company" />
            </form>
            <p v-if="error" role="alert" class="hr-error">{{ error }}</p>
            <p v-if="!company" role="status">상단에서 접근 가능한 회사를 선택해 주세요.</p>
            <p v-else-if="loading" role="status">직원 정보를 불러오는 중입니다.</p>
            <template v-else-if="directory">
                <div class="hr-table" tabindex="0" aria-label="직원 명부 표">
                    <table>
                        <thead>
                            <tr>
                                <th>사번 / 이름</th>
                                <th>상태</th>
                                <th>사업장 / 부서</th>
                                <th>직급 / 직책</th>
                                <th>상세</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="employee in directory.employees" :key="employee.id">
                                <td>
                                    <span class="text-muted-color">{{ employee.employeeNo }}</span
                                    ><br />{{ employee.name }}
                                </td>
                                <td>{{ statusLabel(employee.status) }}</td>
                                <td>{{ siteName(employee.siteId) }}<br />{{ employee.department || '—' }}</td>
                                <td>{{ employee.grade || '—' }} / {{ employee.position || '—' }}</td>
                                <td><Button data-testid="employee-detail" label="상세 보기" :aria-label="`${employee.name} 상세 보기`" severity="secondary" @click="selectedId = employee.id" /></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p v-if="!directory.employees.length" role="status" class="py-6">조건에 맞는 직원이 없습니다.</p>
                <nav class="hr-pagination" aria-label="직원 목록 페이지">
                    <span>총 {{ directory.total }}명 · {{ directory.page }}페이지</span><Button label="이전" severity="secondary" :disabled="directory.page <= 1" @click="load(directory.page - 1)" /><Button
                        label="다음"
                        severity="secondary"
                        :disabled="directory.page * directory.pageSize >= directory.total"
                        @click="load(directory.page + 1)"
                    />
                </nav>
            </template>
        </div>
        <div v-if="selected" class="card" aria-label="선택한 직원 상세">
            <div class="hr-heading">
                <h2 class="text-xl font-semibold">{{ selected.name }} · {{ selected.employeeNo }}</h2>
                <Button v-if="directory.permissions.update && selected.status !== 'terminated'" data-testid="action" label="인사 발령 기록" :disabled="saving || latest?.type === 'terminate'" @click="action" />
            </div>
            <p class="my-4">입사일 {{ selected.hireDate }} · 로그인 계정 {{ selected.profileId ? '연결됨' : '연결 없음' }}</p>
            <h3 class="font-semibold">발령 이력</h3>
            <p v-if="!actions.length" class="text-muted-color mt-3">등록 이후 발령 이력이 없습니다.</p>
            <ol class="hr-history">
                <li v-for="item in actions" :key="item.id">
                    <div>
                        <strong>{{ item.effectiveDate }} · {{ item.type === 'terminate' ? '퇴사' : '주 소속 변경' }}</strong
                        ><span v-if="item.cancelled"> · 취소됨</span><span v-else> · {{ item.effectiveDate > today() ? '예정' : '적용됨' }}</span>
                        <p v-if="item.type === 'transfer'">{{ siteName(item.siteId) }} / {{ item.department || '—' }} / {{ item.grade || '—' }} / {{ item.position || '—' }}</p>
                        <p>{{ item.reason }}</p>
                    </div>
                    <Button v-if="directory.permissions.update && !item.cancelled && latest?.id === item.id && item.effectiveDate > today()" label="발령 취소" severity="secondary" :disabled="saving" @click="cancel(item)" />
                </li>
            </ol>
        </div>
        <Dialog
            :visible="Boolean(dialog)"
            modal
            :header="dialog === 'register' ? '직원 등록' : dialog === 'cancel' ? '예정 발령 취소' : '인사 발령 기록'"
            :style="{ width: '40rem', maxWidth: '95vw' }"
            :closable="!saving"
            @update:visible="
                (value) => {
                    if (!value) close();
                }
            "
        >
            <form data-testid="save-action" class="hr-form" @submit.prevent="save">
                <template v-if="dialog === 'register'">
                    <label for="employee-no">사번 (등록 후 변경 불가)<input id="employee-no" v-model="draft.employeeNo" required maxlength="100" /></label>
                    <label for="employee-name">이름<input id="employee-name" v-model="draft.name" required maxlength="100" /></label>
                    <label for="hire-date">입사일<input id="hire-date" v-model="draft.hireDate" type="date" required /></label>
                    <label for="profile-id"
                        >로그인 계정 연결 (선택)<select id="profile-id" v-model="draft.profileId" aria-describedby="profile-help">
                            <option value="">연결하지 않음</option>
                            <option v-for="account in directory?.accounts || []" :key="account.id" :value="account.id">{{ account.name }}</option>
                        </select></label
                    >
                    <p id="profile-help" class="hr-note">전사 권한관리에서 회사에 연결한 계정을 선택합니다. 등록 후 계정 연결을 변경할 수 없습니다. 입사 예정 계정은 입사일부터 접근할 수 있습니다.</p>
                </template>
                <template v-if="dialog === 'action'"
                    ><label for="action-type"
                        >발령 종류<select id="action-type" v-model="draft.type">
                            <option value="transfer">주 소속 변경</option>
                            <option value="terminate">퇴사</option>
                        </select></label
                    ><label for="action-date">발효일<input id="action-date" v-model="draft.effectiveDate" type="date" :min="today()" required /></label>
                    <p class="hr-note">발효일부터 적용합니다. 퇴사일은 재직하지 않는 첫날입니다. 과거 발령은 기록할 수 없으며 같은 날짜는 취소 후에도 다시 사용할 수 없습니다.</p></template
                >
                <template v-if="dialog === 'register' || (dialog === 'action' && draft.type === 'transfer')"
                    ><label for="employee-site"
                        >주 사업장<select id="employee-site" v-model="draft.siteId">
                            <option value="">미지정</option>
                            <option v-for="site in directory?.sites || []" :key="site.id" :value="site.id">{{ site.name }}</option>
                        </select></label
                    ><label for="employee-department">부서 코드<input id="employee-department" v-model.trim="draft.department" maxlength="150" /></label
                    ><label for="employee-grade">직급 코드<input id="employee-grade" v-model.trim="draft.grade" maxlength="150" /></label
                    ><label for="employee-position">직책 코드<input id="employee-position" v-model.trim="draft.position" maxlength="150" /></label
                ></template>
                <p v-if="dialog === 'action'" class="hr-note">승인 절차 없이 직접 기록됩니다. 주 소속만 관리하며, 직급·직책 변경은 연결 계정의 유효 레벨과 메뉴에 영향을 줍니다. 직접 지정한 레벨과 개별 예외는 유지됩니다.</p>
                <p v-if="dialog === 'cancel'" class="hr-note">{{ cancelTarget?.effectiveDate }} 예정 발령을 취소합니다. 이전 재직 상태와 주 소속이 계속 적용되며 예정된 접근 권한 변경도 취소됩니다.</p>
                <label for="action-reason">변경 사유 (필수)<textarea id="action-reason" v-model="reason" required rows="3" maxlength="2000" /></label>
                <label v-if="dialog === 'cancel' || draft.type === 'terminate'" class="hr-confirm" for="impact-confirm"
                    ><input id="impact-confirm" v-model="confirmed" type="checkbox" />{{ dialog === 'cancel' ? '예정된 권한 변경도 취소됨을 확인했습니다.' : '퇴사일부터 연결 계정의 이 회사 접근이 차단됨을 확인했습니다.' }}</label
                >
                <p v-if="validation || error" role="alert" class="hr-error">{{ validation || error }}</p>
                <div class="hr-pagination"><Button type="button" label="닫기" severity="secondary" :disabled="saving" @click="close" /><Button type="submit" :label="saving ? '저장 중…' : '기록 저장'" :disabled="saving" /></div>
            </form>
        </Dialog>
    </section>
</template>

<style scoped>
.hr-page {
    display: grid;
    gap: 1.5rem;
}
.hr-heading,
.hr-pagination,
.hr-history li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
}
.hr-note {
    color: var(--text-color-secondary);
    line-height: 1.6;
    margin: 1rem 0;
}
.hr-search {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin: 1.5rem 0;
}
.hr-search input {
    flex: 1;
    min-width: 12rem;
}
.hr-page input:not([type='checkbox']),
.hr-page select,
.hr-page textarea,
.hr-form input:not([type='checkbox']),
.hr-form select,
.hr-form textarea {
    border: 1px solid var(--surface-border);
    border-radius: var(--content-border-radius, 6px);
    padding: 0.75rem;
    color: var(--text-color);
    background: var(--surface-card);
    min-height: 44px;
}
.hr-table {
    overflow-x: auto;
}
table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
}
th,
td {
    padding: 1rem;
    border-bottom: 1px solid var(--surface-border);
}
th {
    color: var(--text-color-secondary);
    font-weight: 600;
}
.hr-pagination {
    justify-content: flex-end;
    margin-top: 1.25rem;
}
.hr-form {
    display: grid;
    gap: 1rem;
}
.hr-form label:not(.hr-confirm) {
    display: grid;
    gap: 0.5rem;
}
.hr-confirm {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    line-height: 1.6;
}
.hr-confirm input {
    margin-top: 0.3rem;
}
.hr-error {
    color: var(--p-red-700);
    padding: 0.75rem;
    border: 1px solid var(--p-red-300);
    border-radius: 6px;
}
.hr-history {
    list-style: none;
    padding: 0;
}
.hr-history li {
    padding: 1rem 0;
    border-bottom: 1px solid var(--surface-border);
}
.hr-history p {
    margin: 0.5rem 0 0;
    overflow-wrap: anywhere;
}
@media (max-width: 640px) {
    .hr-heading {
        align-items: flex-start;
    }
    th,
    td {
        padding: 0.75rem;
    }
    .hr-search label {
        width: 100%;
    }
}
</style>
