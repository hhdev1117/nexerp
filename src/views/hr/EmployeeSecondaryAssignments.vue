<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { createHrSecondaryAssignmentRepository } from '@/repositories/hr/hrSecondaryAssignmentRepository'

const props=defineProps({ companyId:{type:String,required:true}, employeeId:{type:String,required:true} })
const emit=defineEmits(['changed'])
const repository=createHrSecondaryAssignmentRepository()
const history=ref(null), preparation=ref(null), loading=ref(false), error=ref(''), mode=ref(''), saving=ref(false)
const draft=ref({employmentId:'',siteId:'',department:'',position:'',startDate:'',endDate:'',reason:''})
let version=0
const statusLabel=s=>({planned:'예정',active:'진행 중',ended:'종료',cancelled:'취소'})[s]||s
async function load(){const v=++version; loading.value=true;error.value='';try{const [h,p]=await Promise.all([repository.loadHistory(props.companyId,props.employeeId),repository.prepare(props.companyId,props.employeeId)]);if(v===version){history.value=h;preparation.value=p}}catch(e){if(v===version)error.value=e.message}finally{if(v===version)loading.value=false}}
function openCreate(){const cycle=preparation.value?.employmentCycles.find(x=>!x.endDate)||preparation.value?.employmentCycles.at(-1);draft.value={employmentId:cycle?.id||'',siteId:'',department:'',position:'',startDate:'',endDate:'',reason:''};mode.value='create'}
async function create(){error.value='';if(!draft.value.siteId||!draft.value.department||!draft.value.position||!draft.value.startDate||!draft.value.reason.trim()){error.value='필수 항목을 입력해 주세요.';return}saving.value=true;try{history.value=await repository.create(props.companyId,props.employeeId,history.value.employeeRevision,{employmentId:draft.value.employmentId,siteId:draft.value.siteId,department:draft.value.department,position:draft.value.position,startDate:draft.value.startDate,endDate:draft.value.endDate||null},draft.value.reason);mode.value='';emit('changed')}catch(e){error.value=e.message}finally{saving.value=false}}
async function cancel(row){const reason=window.prompt('예정 취소 사유를 입력해 주세요.');if(!reason)return;saving.value=true;try{history.value=await repository.cancel(props.companyId,props.employeeId,row.id,history.value.employeeRevision,row.revision,reason);emit('changed')}catch(e){error.value=e.message}finally{saving.value=false}}
watch(()=>[props.companyId,props.employeeId],()=>{mode.value='';load()},{immediate:true});onBeforeUnmount(()=>version++)
</script>

<template>
 <section class="secondary" aria-labelledby="secondary-title">
  <header><div><h3 id="secondary-title">겸직</h3><p>개인 직급은 주 소속의 직급을 그대로 사용합니다.</p></div><button v-if="history?.permissions.create" data-testid="secondary-create-open" @click="openCreate">겸직 등록</button></header>
  <p v-if="loading" role="status">겸직 이력을 불러오는 중입니다.</p><p v-if="error" role="alert">{{ error }}</p>
  <div v-for="row in history?.assignments" :key="row.id" class="assignment" :data-testid="`secondary-assignment-${row.status}`">
   <strong>{{ preparation?.references.find(x=>x.kind==='department'&&x.code===row.department)?.name || row.department }}</strong>
   <span>{{ row.position }} · 개인 직급 {{ row.grade }} · {{ statusLabel(row.status) }}</span><span>{{ row.startDate }} ~ {{ row.endDate || '계속' }}</span>
   <button v-if="row.status==='planned'&&history.permissions.cancel" :disabled="saving" @click="cancel(row)">예정 취소</button>
  </div>
  <form v-if="mode==='create'" @submit.prevent="create">
   <label for="secondary-site">사업장</label><select id="secondary-site" v-model="draft.siteId"><option value="">선택</option><option v-for="x in preparation.sites" :key="x.id" :value="x.id">{{ x.name }}</option></select>
   <label for="secondary-department">부서</label><select id="secondary-department" v-model="draft.department"><option value="">선택</option><option v-for="x in preparation.references.filter(x=>x.kind==='department')" :key="x.code" :value="x.code">{{ x.name }}</option></select>
   <label for="secondary-position">직책</label><select id="secondary-position" v-model="draft.position"><option value="">선택</option><option v-for="x in preparation.references.filter(x=>x.kind==='position')" :key="x.code" :value="x.code">{{ x.name }}</option></select>
   <label for="secondary-start-date">시작일</label><input id="secondary-start-date" v-model="draft.startDate" type="date"><label for="secondary-end-date">종료일(선택)</label><input id="secondary-end-date" v-model="draft.endDate" type="date">
   <label for="secondary-reason">등록 사유</label><textarea id="secondary-reason" v-model="draft.reason" maxlength="2000" />
   <div><button type="button" @click="mode=''">닫기</button><button data-testid="secondary-review" :disabled="saving">{{ saving?'저장 중':'등록' }}</button></div>
  </form>
 </section>
</template>
<style scoped>
.secondary{margin-top:1rem;padding:1rem;border:1px solid var(--surface-border,#ddd);border-radius:12px}.secondary header{display:flex;justify-content:space-between;gap:1rem}.secondary h3{margin:0}.secondary p{margin:.35rem 0;color:var(--text-color-secondary,#666)}.assignment{display:grid;gap:.35rem;padding:.8rem 0;border-top:1px solid var(--surface-border,#ddd)}form{display:grid;grid-template-columns:minmax(120px,180px) 1fr;gap:.55rem;margin-top:1rem}input,select,textarea,button{min-height:44px}form div{grid-column:2;display:flex;gap:.5rem}@media(max-width:640px){form{grid-template-columns:1fr}form div{grid-column:1}.secondary header{align-items:flex-start;flex-direction:column}}
</style>
