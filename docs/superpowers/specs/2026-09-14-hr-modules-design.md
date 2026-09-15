# Company HR Module Controls

Continue approved design, implement company-level controls for currently shipped hr.core and expose other planned HR modules as unavailable (no fake enable controls). No site overrides until site-scoped modules exist. Module state never disables current employment-derived ERP membership; it gates HR business operations only, preserving termination/access safety. Technical administrators manage settings through fixed recovery route /settings/hr-modules even if HR business disabled, without gaining employee reads.

## States and concurrency

hr.core defaults enabled/menuVisible true/revision0 for existing companies. enabled allows current grants; draining allows read/menu and future action cancellation only, rejects employee create/correct/new action/reference writes. read_only allows read/menu only. disabled rejects all HR menu/route/RPC reads/writes. menuVisible=false hides sidebar only; permitted direct URL remains. HR permission grants still required in every state.

Future uncancelled personnel actions (effective_date>Seoul today) block transition into read_only or disabled, including changing visibility while already blocked is irrelevant. Draining permits future scheduled actions to take effect (existing work) or authorized operator cancellation; no new work. HR directory permissions.create/update false outside enabled; new permissions.cancel boolean enabled/draining plus original update grant (cancel operation separated from update UI). Cancellation RPC must recheck original update privilege+state through new helper, not broaden grant requirements.

All HR reads/writes and state changes serialize via company lock consistently. Existing RPC paths lock employee before trigger company; avoid deadlock by acquiring company in authorization before employee lock (replace hr_authorize to volatile and lock company before state/grant test). Cancellation special authorization helper locks company first. Stable read directory invoking volatile lock helper acceptable after testing; if READ ONLY transaction issue, use independent read helper with no write lock, but all mutations must lock before employee. Actual SQL statement snapshots after lock must observe latest committed state. No changes to migrations001-005.

## RPC contract

hr_module_settings(target_company) admin AAL2 -> {companyId,modules:[{key,label,available:boolean,state:'enabled'|'draining'|'read_only'|'disabled',menuVisible:boolean,revision:int>=0,pendingActions:int>=0,dependents:string[]}]}.

Registry hr.core available true label '인사 기본'; other 18 HR module keys from full design available false, state disabled/menuVisible false/revision0/pendingActions0 (informational only). depends none for available core today; future modules must register real blockers before becoming available.

hr_save_module_settings(target_company,module_key,expected_revision,desired_state,menu_visible,change_reason) -> same full settings response. Only hr.core currently accepted. Admin only, nonempty reason<=2000, bool visibility, valid state, expected revision conflict40001, pending block22023 message module_pending_actions, unsupported module22023 module_unavailable. Company setting row created atomically revision1 first save; append before/after audit incl actor/reason. Direct table writes revoked/RLS. Technical admin catalog uses existing enterprise_access_companies RPC.

Runtime enterprise_access_context adds hiddenMenuKeys:string[] (always array, subset menuKeys). Keep menuKeys authorization semantics; disabled HR omitted; menu hidden only in hiddenMenuKeys. Client validator defaults missing hiddenMenuKeys to[] for old servers; validates when present. Sidebar excludes hidden keys, direct route guard still canAccess. Company selector suggested destinations exclude hidden. No need permission-policy re-publish for module state changes.

hr_directory response permissions adds cancel:boolean, always. Existing repository optional cancel fallback update for migration compatibility? new client must default false when absent (safe) and UI cancels only with cancel. Current core store.cancelAction uses cancel permission, not update. Existing tests update fixture.

## UI

Admin HRModules.vue fixed recovery screen with own admin company picker, state cards/table (available vs planned), pending action count, reason, explicit change review and confirm, revision/error/retry. Explain closing preserves records and other ERP membership; pending rows need settlement; unsupported modules visibly not enabled. Save then refresh global runtime same identity, preserve own admin draft on refresh already handled AppLayout fixedAccess.

HR employee page displays current state? Add moduleState to hr_directory optional fallback enabled for old server and use banner explaining draining/read_only. Cancel enabled only permissions.cancel even when update false; read_only no writes. New module policy management remains technical admin only. HR self/main menu policies unaffected except hr.core disabled gate.
