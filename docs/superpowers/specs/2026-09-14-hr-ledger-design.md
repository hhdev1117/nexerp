# HR Employee Ledger and Personnel Actions

## Scope and accepted direction

Continue the approved HR design with a deployable employee ledger slice: employee registration, optional immutable login link, dated primary assignment changes, termination, future-action cancellation, server-derived access. Existing PrimeVue ERP styling and Korean labels remain. No payroll/private fields or full organization hierarchy in this slice.

## Data and authorization

Company-scoped employees have immutable employee number, name, optional profile UUID, hire date, initial site/department code/grade code/position code, revision and audit actor. Personnel actions are immutable dated transfer/termination records with cancellation audit. Effective dates are inclusive; termination date is first non-employed date. One action per employee/date; chronology appended, cancel only future latest action, prohibit dates before hire or backdated before today. No account reassignment or rehire in this slice.

Employee link does not grant membership: published membership still required. For linked users the server derives active state and grade/position/site/organization from current ledger at Seoul date, preserving explicit level and overrides. Future actions apply on request evaluation without background job; termination blocks company membership, and reverting access publication cannot restore it. Unlinked policy users remain compatible.

New resource hr.core with menu/read/create/update. HR data requires published company-wide explicit hr.core grants; no technical admin data bypass. First bootstrap: tech admin adds/publishes own or HR operator grants through existing policy editor. New menus denied until configured. Minimal non-sensitive ledger, company composite references, row security, RPC writes, revision locks and audit reasons. Broad site/organization employee scopes are not silently widened; only company scope supported in this slice.

## RPC contract

hr_directory(target_company, search_text='', page_number=1) returns {employees:[{id,companyId,employeeNo,name,profileId,hireDate,siteId,department,grade,position,status,revision,actions:[{id,type,effectiveDate,siteId,department,grade,position,reason,cancelled}]}],total,page,pageSize:25,permissions:{create:boolean,update:boolean},sites:[{id,name}],accounts:[{id,name}]}.

hr_create_employee(target_company,employee_document,change_reason) returns employee UUID. employee_document={employeeNo,name,profileId:null|UUID,hireDate,siteId:null|UUID,department,grade,position}. Profile link must be an active profile in an active published company membership and unique per company. Directory accounts catalog excludes linked profiles and is only returned for create-granted users; future memberships remain selectable. Never leak account directory via HR.

hr_record_personnel_action(target_company,target_employee,expected_revision,action_document) returns action UUID. action_document={type:'transfer'|'terminate',effectiveDate,siteId:null|UUID,department,grade,position,reason}.

hr_cancel_personnel_action(target_company,target_employee,target_action,expected_revision,change_reason) returns void/null. Mutation results followed by reload and runtime refresh; enforce stale company identity protections.

## UI

/hr/employees resource hr.core. Current global company, search and server page controls, employee list with readable status, register dialog, employee detail and chronological actions, action dialog with impact/date/required reason, explicit termination/cancellation confirm. No mocked fallback. Company/identity changes immediately clear records/forms. Error/loading/empty states keyboard accessible.

Ruling: account selection uses the company policy catalog, not manual UUID entry. Narrow HR denies conservatively deny the action rather than broadening employee row scope. Termination keeps the last effective transfer and permits existing inactive same-company sites.
