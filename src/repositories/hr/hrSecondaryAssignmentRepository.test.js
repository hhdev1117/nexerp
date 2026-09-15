import { describe, expect, it, vi } from 'vitest'
import { createHrSecondaryAssignmentRepository } from './hrSecondaryAssignmentRepository'

const company='92000000-0000-4000-8000-000000000001', employee='94000000-0000-4000-8000-000000000001', employment='95000000-0000-4000-8000-000000000001', site='93000000-0000-4000-8000-000000000001'
const history={companyId:company,employeeId:employee,employeeRevision:2,permissions:{create:true,end:true,cancel:true},assignments:[{id:'96000000-0000-4000-8000-000000000001',employmentId:employment,employmentSequence:1,siteId:site,department:'DEV',grade:'STAFF',position:'TEAM_LEAD',startDate:'2026-10-01',endDate:null,status:'planned',reason:'겸직',endReason:null,cancellationReason:null,revision:1}]}

describe('secondary assignment repository',()=>{
 it('uses the exact create RPC contract',async()=>{const client={rpc:vi.fn().mockResolvedValue({data:history,error:null})};const repo=createHrSecondaryAssignmentRepository(client);const document={employmentId:employment,siteId:site,department:'DEV',position:'TEAM_LEAD',startDate:'2026-10-01',endDate:null};await repo.create(company,employee,1,document,' 겸직 ');expect(client.rpc).toHaveBeenCalledWith('hr_create_secondary_assignment',{target_company:company,target_employee:employee,expected_employee_revision:1,assignment_document:document,change_reason:'겸직'})})
 it('rejects malformed server documents',async()=>{const client={rpc:vi.fn().mockResolvedValue({data:{...history,assignments:[{...history.assignments[0],grade:undefined}]},error:null})};await expect(createHrSecondaryAssignmentRepository(client).loadHistory(company,employee)).rejects.toMatchObject({code:'hr_secondary_request_failed'})})
 it('maps stable overlap errors',async()=>{const client={rpc:vi.fn().mockResolvedValue({data:null,error:{code:'22023',message:'secondary_overlap'}})};await expect(createHrSecondaryAssignmentRepository(client).loadHistory(company,employee)).rejects.toMatchObject({code:'secondary_overlap',message:'같은 부서의 겸직 기간이 기존 겸직과 겹칩니다.'})})
})
