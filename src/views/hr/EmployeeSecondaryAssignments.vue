<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { createHrSecondaryAssignmentRepository } from '@/repositories/hr/hrSecondaryAssignmentRepository'
import { useAuthStore } from '@/stores/auth'

const props=defineProps({ companyId:{type:String,required:true}, employeeId:{type:String,required:true} })
const emit=defineEmits(['changed'])
const repository=createHrSecondaryAssignmentRepository()
const auth=useAuthStore()
const history=ref(null), preparation=ref(null), loading=ref(false), error=ref(''), mode=ref(''), saving=ref(false)
const draft=ref({employmentId:'',siteId:'',department:'',position:'',startDate:'',endDate:'',reason:''})
const actionTarget=ref(null), actionReason=ref(''), actionEndDate=ref('')
let version=0
const statusLabel=s=>({planned:'예정',active:'진행 중',ended:'종료',cancelled:'취소'})[s]||s
async function load(){const v=++version; loading.value=true;error.value='';try{const [h,p]=await Promise.all([repository.loadHistory(props.companyId,props.employeeId),repository.prepare(props.companyId,props.employeeId)]);if(v===version){history.value=h;preparation.value=p}}catch(e){if(v===version)error.value=e.message}finally{if(v===version)loading.value=false}}
function openCreate(){const cycle=preparation.value?.employmentCycles.find(x=>!x.endDate)||preparation.value?.employmentCycles.at(-1);draft.value={employmentId:cycle?.id||'',siteId:'',department:'',position:'',startDate:'',endDate:'',reason:''};mode.value='create'}
function reviewCreate(){error.value='';if(!draft.value.siteId||!draft.value.department||!draft.value.position||!draft.value.startDate||!draft.value.reason.trim()){error.value='필수 항목을 입력해 주세요.';return}mode.value='review'}
function referenceName(kind,code){return preparation.value?.references.find(x=>x.kind===kind&&x.code===code)?.name||code}
function positionLevel(code){return preparation.value?.mappings.find(x=>x.kind==='position'&&x.code===code)?.level||null}
async function create(){saving.value=true;try{history.value=await repository.create(props.companyId,props.employeeId,history.value.employeeRevision,{employmentId:draft.value.employmentId,siteId:draft.value.siteId,department:draft.value.department,position:draft.value.position,startDate:draft.value.startDate,endDate:draft.value.endDate||null},draft.value.reason);mode.value='';emit('changed')}catch(e){error.value=e.message}finally{saving.value=false}}
function openAction(row,type){actionTarget.value=row;actionReason.value='';actionEndDate.value='';mode.value=type}
async function saveAction(){if(!actionReason.value.trim()||(mode.value==='end'&&!actionEndDate.value)){error.value='종료일과 사유를 입력해 주세요.';return}saving.value=true;try{history.value=mode.value==='end'?await repository.end(props.companyId,props.employeeId,actionTarget.value.id,history.value.employeeRevision,actionTarget.value.revision,actionEndDate.value,actionReason.value):await repository.cancel(props.companyId,props.employeeId,actionTarget.value.id,history.value.employeeRevision,actionTarget.value.revision,actionReason.value);mode.value='';emit('changed')}catch(e){error.value=e.message}finally{saving.value=false}}
watch(()=>[props.companyId,props.employeeId,auth.user.value?.id],()=>{mode.value='';actionTarget.value=null;load()},{immediate:true});onBeforeUnmount(()=>version++)
</script>

<template>
 <section class="secondary" aria-labelledby="secondary-title">
  <header><div><h3 id="secondary-title">겸직</h3><p>개인 직급은 주 소속의 직급을 그대로 사용합니다.</p></div><button v-if="history?.permissions.create" data-testid="secondary-create-open" @click="openCreate">겸직 등록</button></header>
  <p v-if="loading" role="status">겸직 이력을 불러오는 중입니다.</p><p v-if="error" role="alert">{{ error }}</p>
  <p v-if="history&&!history.permissions.create&&!history.permissions.end&&!history.permissions.cancel" data-testid="secondary-readonly">겸직 이력은 조회만 가능합니다.</p>
  <div v-for="row in history?.assignments" :key="row.id" class="assignment" :data-testid="`secondary-assignment-${row.status}`">
   <strong>{{ preparation?.references.find(x=>x.kind==='department'&&x.code===row.department)?.name || row.department }}</strong>
   <span>{{ row.position }} · 개인 직급 {{ row.grade }} · {{ statusLabel(row.status) }}</span><span>{{ row.startDate }} ~ {{ row.endDate || '계속' }}</span>
   <button v-if="row.status==='planned'&&history.permissions.cancel" :disabled="saving" @click="openAction(row,'cancel')">예정 취소</button><button v-if="row.status==='active'&&history.permissions.end" :disabled="saving" @click="openAction(row,'end')">겸직 종료</button>
  </div>
  <form v-if="mode==='create'" @submit.prevent="create">
   <label for="secondary-site">사업장</label><select id="secondary-site" v-model="draft.siteId"><option value="">선택</option><option v-for="x in preparation.sites" :key="x.id" :value="x.id">{{ x.name }}</option></select>
   <label for="secondary-department">부서</label><select id="secondary-department" v-model="draft.department"><option value="">선택</option><option v-for="x in preparation.references.filter(x=>x.kind==='department')" :key="x.code" :value="x.code">{{ x.name }}</option></select>
   <label for="secondary-position">직책</label><select id="secondary-position" v-model="draft.position"><option value="">선택</option><option v-for="x in preparation.references.filter(x=>x.kind==='position')" :key="x.code" :value="x.code">{{ x.name }}</option></select>
   <label for="secondary-start-date">시작일</label><input id="secondary-start-date" v-model="draft.startDate" type="date"><label for="secondary-end-date">종료일(선택)</label><input id="secondary-end-date" v-model="draft.endDate" type="date">
   <label for="secondary-reason">등록 사유</label><textarea id="secondary-reason" v-model="draft.reason" maxlength="2000" />
   <div><button type="button" @click="mode=''">닫기</button><button type="button" data-testid="secondary-review" @click="reviewCreate">검토</button></div>
  </form>
  <div v-if="mode==='review'" data-testid="secondary-review-panel" class="review"><strong>등록 내용 확인</strong><p>개인 직급 {{ referenceName('grade',preparation.primary.grade) }} 유지 · 겸직 직책 레벨 {{ positionLevel(draft.position) || '미매핑' }} · {{ referenceName('department',draft.department) }} 및 하위 조직</p><p>{{ draft.startDate }} ~ {{ draft.endDate || '계속' }}</p><button @click="mode='create'">수정</button><button data-testid="secondary-create-save" :disabled="saving" @click="create">{{ saving?'저장 중':'확정 등록' }}</button></div>
  <form v-if="mode==='end'||mode==='cancel'" @submit.prevent="saveAction"><template v-if="mode==='end'"><label for="secondary-action-end">종료일</label><input id="secondary-action-end" v-model="actionEndDate" type="date"></template><label for="secondary-action-reason">{{ mode==='end'?'종료':'취소' }} 사유</label><textarea id="secondary-action-reason" v-model="actionReason" maxlength="2000"/><div><button type="button" @click="mode=''">닫기</button><button type="submit" data-testid="secondary-action-save" :disabled="saving" @click.prevent="saveAction">{{ saving?'저장 중':'확정' }}</button></div></form>
 </section>
</template>
<style scoped>
.secondary{margin-top:1rem;padding:1rem;border:1px solid var(--surface-border,#ddd);border-radius:12px}.secondary header{display:flex;justify-content:space-between;gap:1rem}.secondary h3{margin:0}.secondary p{margin:.35rem 0;color:var(--text-color-secondary,#666)}.assignment{display:grid;gap:.35rem;padding:.8rem 0;border-top:1px solid var(--surface-border,#ddd)}form{display:grid;grid-template-columns:minmax(120px,180px) 1fr;gap:.55rem;margin-top:1rem}input,select,textarea,button{min-height:44px}form div{grid-column:2;display:flex;gap:.5rem}@media(max-width:640px){form{grid-template-columns:1fr}form div{grid-column:1}.secondary header{align-items:flex-start;flex-direction:column}}
</style>
