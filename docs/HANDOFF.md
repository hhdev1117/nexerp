# NEXERP 인수인계 문서

> 기준 시점: 2026-09-15, `feature/partner-master` 브랜치에서 거래처 기준정보 운영 적용 후 최종 검토 수정까지 반영. 이 문서는 여러 AI 도구와 사람이 같은 저장소에서 번갈아 작업할 때 현재 상태, 지켜야 할 규약, 다음 할 일을 한곳에서 확인하기 위해 유지합니다. 작업 단위를 끝낼 때마다 "현재 상태"와 "다음 할 일"을 갱신하고 함께 커밋해 주세요.

## 1. 한눈에 보기

| 항목 | 상태 |
|---|---|
| 스택 | Vue 3 + PrimeVue 4 + Tailwind, Cloudflare Workers Static Assets, Supabase (Auth + Postgres + RLS), Vitest |
| 최신 구현 커밋 | `61b3a60 docs: correct partner rollout deployment record` 기반 최종 검토 수정 진행 중. 최종 커밋과 검증 수치는 아래 실행 기록에서 갱신 |
| 작업 트리 | 최종 수정 브랜치 `feature/partner-master`. 원격 푸시는 컨트롤러 최종 재검토와 main 통합 후 진행 |
| 검증 | 최종 수정 전 Vitest 47개 파일 643개 통과, ESLint 무결, `npm run build` 성공, 운영 의존성 취약점 0개, Wrangler dry-run 성공. 수정 후 전체 검증 결과는 아래에 추가 |
| Supabase 운영 프로젝트 | `mehhrnbaiojivesnobpv` (`nexerp`). 이전 문서·계획의 `kctewzpeymlncibgyosz`는 오래된 프로젝트 식별자이므로 사용하지 않음 |
| 운영 스키마 / CLI 이력 | 회사·사업장 및 거래처 스키마는 2026-09-14 운영 프로젝트에 적용하고 카탈로그 검증 완료. 단, CLI migration history는 미복구이며 복구 전 `db push` 금지 |
| 미실행 테스트 | pgTAP `companies_sites_rls.test.sql` 35개와 `partners_rls.test.sql` 38개. 이 PC에 Docker가 없어 실행 불가 |
| 확정된 결정 | 다회사·다사업장. 모든 업무 테이블은 `company_id`를 가지며 고객/공급처는 `master.partners`에서 통합 관리 |
| 운영 배포 | Cloudflare Worker 버전 `61f5266c-d201-48c9-940a-eeb22fc7de05`, 진입 자산 `index-Cbfjxbkr.js`, `https://nexerp.merciful-chips.workers.dev` |

## 2. 현재 구현 상태

| 영역 | 상태 | 위치 |
|---|---|---|
| 인증 (이메일+비밀번호, 필수 TOTP, Gmail 전용 계정) | 완료, Supabase 영속 | `src/stores/auth.js`, `src/views/auth/*`, `worker/*` |
| 역할 admin / approver / user, 역할별 메뉴 권한 | 완료, Supabase 영속 | `src/stores/access.js`, `supabase/migrations/20260912000100_*` |
| 계정 관리, 메뉴 권한 관리, 인프라 사용량, 2단계 인증 관리 | 완료 (Worker API + RPC) | `src/views/admin/*`, `worker/admin.js`, `worker/infrastructure.js` |
| **회사 · 사업장 기준정보** | 구현·운영 마이그레이션·배포 완료. 관리자 MFA 등록 후 실제 등록 점검 대기 | `src/views/master/CompanySites.vue`, `src/stores/master.js`, `src/repositories/master/*` |
| **거래처 통합 기준정보** | 구현·운영 마이그레이션·배포 완료. 고객/공급처 레거시 경로 통합, 관리자 MFA 후 실제 CRUD 및 역할별 UI 점검 대기 | `src/views/master/Partners.vue`, `src/stores/master.js`, `src/repositories/master/*` |
| 결재함, 수주 관리, 재고 현황, 재무 현황, 통합 대시보드 | 데모 (메모리 리포지토리) | `src/views/erp/*`, `src/views/Dashboard.vue`, `src/stores/erp.js` |
| 나머지 27개 메뉴 (견적, 발주, 입고, BOM, 전표 등) | 플레이스홀더 공용 화면 | `src/views/erp/GenericModule.vue` |

Supabase에 존재하는 앱 테이블은 `profiles`, `role_menu_permissions`, `companies`, `sites`, `partners` 다섯 개입니다. 나머지 업무 데이터는 아직 테이블이 없습니다.

## 3. 이번 세션에서 한 일

### 커밋 `42dce82` — 기반 정리 4종

1. **Sakai 템플릿 잔여물 삭제.** `src/views/pages`, `src/views/uikit`, `src/views/utilities`, `src/components/landing`, `src/components/BlockViewer.vue`, `src/components/FloatingConfigurator.vue`, `src/service/*`, `src/assets/demo`, `public/demo`를 제거했습니다. 라우터가 쓰던 404 페이지는 `src/views/NotFound.vue`로 새로 만들었습니다. `src/project-naming.test.js`가 삭제된 경로의 부재를 검사합니다.
2. **결재 권한.** `src/views/erp/Approvals.vue`에서 `authStore.hasRole(APPROVAL_DECISION_ROLES)`(admin, approver)만 승인/반려 버튼을 봅니다. 다른 역할은 조회 전용 안내와 "결재자 처리 대기" 표시만 봅니다. 라우터 `/approvals`에는 의도적으로 `roles` 메타를 두지 않았습니다(기존 라우터 테스트가 이를 단언). 메뉴 권한은 조회 범위, 역할은 처리 권한이라는 경계입니다. 서버 측 강제는 결재 테이블을 만들 때 RLS/RPC로 추가해야 합니다.
3. **상태 코드 상수화.** `src/data/status.js` 하나에 12개 상태를 정의합니다. 레코드는 영문 코드(`pending_approval`, `approved`, `rejected`, `awaiting_shipment`, `overdue`, `on_hold`, `in_review`, `in_progress`, `done`, `normal`, `low`, `critical`)를 저장하고, 화면은 `statusLabel()`/`statusSeverity()`로 한글 라벨과 색을 얻습니다. 도메인별(`order`, `approval`, `task`, `stock`) 상태 전이 규칙을 `canTransition()`/`assertTransition()`으로 검증하며, 재고 상태는 `stockStatusFor(stock, safety)`로 계산합니다(안전재고의 50% 미만이면 `critical`, 미만이면 `low`).
4. **리포지토리 쓰기 계약.** `src/repositories/erp/index.js`의 계약이 조회 3개에서 비동기 8개로 늘었습니다: `listOrders`, `createOrder`, `updateOrder`, `deleteOrder`, `listApprovals`, `updateApprovalStatus`, `listGenericRecords`, `createGenericRecord`. 문서번호(`SO-YYMMDD-NNN`), ID, 수정 시각 발급은 데모 리포지토리가 맡습니다. `src/stores/erp.js`는 `loading`/`error`를 노출하고, 결재 상태 변경과 수주 상태 변경 전에 전이 규칙을 검증합니다.

### 커밋 `e7c3f0e` — 회사 · 사업장 기준정보

- **마이그레이션** `20260914000100_add_companies_and_sites.sql`
  - `public.companies(id, code, name, business_number, representative, address, is_active, created_at, updated_at, created_by, updated_by)`. `code` 유일, 형식 `^[A-Z0-9][A-Z0-9-]{1,19}$`. `business_number`는 숫자 10자리, null 허용, 부분 유일 인덱스.
  - `public.sites(id, company_id → companies, code, name, site_type enum(head_office, factory, warehouse, branch, other), address, is_active, 감사 컬럼)`. `(company_id, code)` 유일.
  - `private.is_active_user()`: AAL2 이고 활성 프로필이면 true. 조회 정책에 사용. 쓰기 정책은 기존 `private.is_admin()`.
  - grants는 `select, insert, update`만. delete 권한 없음(비활성화로 대체).
  - 트리거: `set_master_audit_columns`(작성자/수정자를 `auth.uid()`로 강제), `enforce_site_company_active`(비활성 회사 아래 활성 사업장 금지, `22023 company_inactive`), `deactivate_company_sites`(회사 비활성화 시 소속 사업장 연쇄 비활성화).
- **도메인 규칙** `src/data/master.js`: 코드 정규화(대문자), 사업자등록번호 정규화/포맷, 초안 생성, 검증, 페이로드 변환, 사업장 유형 라벨.
- **리포지토리** `src/repositories/master/`: `errors.js`(`MasterRepositoryError`, 안정 코드 → 한글 메시지), `demoMasterRepository.js`(DB 규칙을 흉내내는 메모리 구현, 시드 2회사 3사업장), `supabaseMasterRepository.js`(컬럼 매핑, Postgres 에러 코드 매핑), `index.js`(`MASTER_REPOSITORY_METHODS`, `assertMasterRepository`, `createDefaultMasterRepository`: Supabase 클라이언트가 있으면 Supabase, 없으면 데모).
- **스토어** `src/stores/master.js`: `createMasterStore({ repository })`와 싱글턴 `useMasterStore()`. 자동 로드하지 않으므로 화면이 `ensureLoaded()`를 호출합니다. 회사 비활성화 후 사업장을 다시 조회해 연쇄 결과를 반영합니다.
- **화면** `src/views/master/CompanySites.vue` (`/settings/company`, 메뉴 키 `settings.company`): 회사 목록(단일 선택) + 선택 회사의 사업장 목록, 등록/수정 대화상자, 비활성화 확인. 관리자만 쓰기 버튼을 봅니다. 코드는 수정 화면에서 잠금(불변).
- **대시보드** `src/views/Dashboard.vue`: 회사/사업장 필터가 등록된 기준정보를 따릅니다. 수치 자체는 여전히 `getDashboardSnapshot()`의 가짜 계수입니다.
- **문서**: README 첫 단락, `docs/setup/cloudflare-supabase.md`의 마이그레이션 설명 갱신.

### 커밋 `1f74169` ~ `ac2f730` — 거래처 통합 기준정보

- **메뉴 통합**: 고객 `sales.customers`와 공급처 `purchasing.vendors` 메뉴를 `master.partners` 하나로 합쳤습니다. 기존 `/sales/customers`, `/purchasing/vendors` 북마크는 `/master/partners`로 리다이렉트됩니다.
- **마이그레이션** `20260914000200_add_partners.sql`: 회사별 코드와 사업자번호 유일성, 고객/공급업체 복수 역할, 비활성화, 감사 컬럼을 갖는 `public.partners`를 만들었습니다. 활성 AAL2 사용자는 조회하고 관리자만 등록·수정할 수 있으며 delete grant는 없습니다. 감사 트리거와 활성 회사 강제 트리거를 사용합니다.
- **권한 이전**: 기존 고객/공급처 메뉴 권한을 가진 역할에 `master.partners`를 보존한 뒤 두 레거시 키를 제거하고 revision을 올립니다. 관리자 보호 트리거는 이전 동안만 비활성화하고 다시 활성화합니다.
- **도메인·리포지토리·스토어**: `src/data/master.js`, `src/repositories/master/*`, `src/stores/master.js`에 거래처 검증, 오류 매핑, demo/Supabase 구현, 캐시와 CRUD를 회사·사업장 패턴으로 추가했습니다.
- **화면** `src/views/master/Partners.vue`: 회사 선택, 검색, 고객/공급업체 역할, 등록·수정·비활성/활성 전환을 제공합니다. 일반 사용자는 조회 전용이고 관리자만 쓰기 UI를 봅니다.
- **코드 불변**: 거래처 코드는 수정 대화상자에서 잠기고 수정 페이로드에서 빠집니다. demo/Supabase 리포지토리도 `updatePartner()`에 전달된 `code`를 무시하므로 애플리케이션 저장소 경로에서 기존 코드가 유지됩니다.
- **운영 적용**: 실제 프로젝트 `mehhrnbaiojivesnobpv`에 정확한 SQL을 적용했습니다. table/RLS, 최소 권한, 정책 3개, 트리거 2개, 제약·인덱스, 보안 함수, 권한 키 통합, 관리자 보호 트리거 복원, 빈 테이블을 모두 확인했습니다.
- **배포 교정**: 첫 격리 워크트리 배포 `444dfd1c-3082-49b4-94c7-24bee73bcd09`는 Git 제외 파일 `.env.local`이 없어 Supabase 미설정 번들을 만들었고 `/auth/setup`으로 이동했습니다. 루트의 운영 `.env.local`을 워크트리에 복사한 뒤 빌드 자산에 실제 프로젝트 ID가 포함됐는지 확인하고 `61f5266c-d201-48c9-940a-eeb22fc7de05`로 재배포했습니다. 앞 버전은 최종 운영 버전이 아닙니다.

## 4. 아키텍처 규약 (새 모듈은 이 패턴을 따르세요)

레이어는 `src/data`(순수 도메인 규칙, 부작용 없음) → `src/repositories`(계약 + demo + supabase) → `src/stores`(캐시와 상태) → `src/views` 입니다. 참고 구현은 회사 · 사업장 모듈입니다.

**데이터베이스**
- 모든 업무 테이블에 `company_id uuid not null references public.companies(id)`를 둡니다. 사업장 단위 데이터는 `site_id`도 둡니다.
- RLS를 반드시 켜고 `revoke all ... from public, anon, authenticated` 후 필요한 grant만 줍니다. 조회는 `(select private.is_active_user())`, 일반 쓰기는 `(select private.is_admin())` 또는 역할 조건. 복합 검증이나 동시성 제어가 필요하면 `security definer` RPC(`admin_replace_role_menu_permissions` 참고).
- 삭제하지 않고 `is_active`로 비활성화합니다. delete grant를 주지 않습니다.
- 감사 컬럼(`created_at`, `updated_at`, `created_by`, `updated_by`)은 트리거가 채우고 클라이언트 값을 무시합니다. `private.set_master_audit_columns()`를 재사용하세요.
- 코드 컬럼은 `^[A-Z0-9][A-Z0-9-]{1,19}$` check 제약을 씁니다. 클라이언트는 `normalizeCode()`로 대문자 정규화합니다.
- 업무 규칙 위반은 `raise exception using errcode = '22023', message = 'snake_case_reason'` 형태로 던지고, 리포지토리가 그 메시지를 안정 코드로 매핑합니다.
- 마이그레이션마다 두 종류 테스트를 둡니다: SQL 텍스트 계약 테스트(`supabase/migrations/<name>.test.js`)와 pgTAP(`supabase/tests/<name>.test.sql`, `plan(N)` 개수 정확히).

**리포지토리**
- 모든 메서드는 비동기이고, 쓰기는 저장된 레코드를 반환합니다(서버가 발급한 id, 번호, 시각 포함).
- 계약은 `*_REPOSITORY_METHODS` 배열로 선언하고 `assert*Repository()`로 검증합니다.
- 데모 구현체는 서버 규칙(유일성, 활성 여부, 연쇄 처리)을 흉내 내어 UI가 연결 전에도 같은 동작을 합니다. 검증을 마친 뒤에 ID를 발급하세요.
- 에러는 원본 provider 메시지를 절대 노출하지 않습니다. `code` + 한글 메시지를 가진 Error 하위 클래스를 쓰고, 테스트에서 `sentinel` 문자열이 새지 않는지 확인합니다.
- Postgres 코드 매핑 기준: `23505` → `duplicate_code`, `23514`/`22023` → `invalid_value`(단, 메시지가 규칙 이름이면 그 이름), `42501` → `admin_required`, `PGRST116` → `not_found`.

**스토어와 화면**
- 스토어는 `create*Store({ repository })` 팩토리 + `use*Store()` 싱글턴 구조입니다. `loading`, `error`(한글), 파생 computed를 노출합니다.
- 상태 값은 `src/data/status.js`의 코드를 쓰고, 화면은 `statusLabel`/`statusSeverity`/`statusOptions(domain)`을 씁니다. 새 상태가 필요하면 그 파일에 추가하고 `status.test.js`를 갱신합니다.
- 화면 접근성 규약: `<h1>` 하나, 입력마다 `id`/`inputId`와 `<label for>`, 오류 메시지 `role="alert"` + `aria-describedby`, 첫 오류 필드로 포커스, 행 작업 버튼에 `aria-label`, 넓은 표는 `scrollable` + 작업 열 `frozen alignFrozen="right"`.
- 쓰기 권한 UI는 `authStore.hasRole([...])`로 가립니다. `hasRole`은 비활성 프로필이면 false입니다.

**테스트**
- 마운트 테스트는 `// @vitest-environment jsdom`, `@vue/test-utils`, PrimeVue 플러그인, `vi.mock('@/stores/auth')`를 씁니다. PrimeVue `Select`/`Dialog`를 마운트하면 `window.matchMedia` 스텁이 필요합니다(`src/views/master/company-sites.test.js` 참고).
- Vitest는 `.env.local`을 로드하므로 `getSupabaseClient()`가 테스트에서 실제 클라이언트를 만들 수 있습니다. 스토어는 리포지토리를 주입하고, 화면 테스트는 `use*Store`를 mock 하세요. 네트워크를 타는 테스트가 있으면 잘못된 것입니다.
- 소스 문자열 단언 테스트(`readFileSync` 후 `toContain`)가 많습니다. 템플릿 속성 순서를 바꾸면 깨질 수 있으니 실패 메시지를 보고 의도를 유지하며 갱신하세요.

**코드 스타일과 커밋**
- Prettier: 4칸 들여쓰기, 홑따옴표, `printWidth: 250`, trailing comma 없음. ESLint: `plugin:vue/vue3-essential` + `eslint:recommended`.
- 커밋 메시지는 영어 Conventional Commits(`feat:`, `fix:`, `refactor:`, `docs:`) 한 줄 제목 + 불릿 본문. 작업 단위마다 커밋합니다. 푸시는 사용자 지시가 있을 때만.
- 검증 세트(커밋 전 필수):

```bash
npm test -- --run
npx eslint src worker docs supabase --ext .vue,.js,.jsx,.cjs,.mjs --quiet
npm run build
```

## 5. 환경 메모 (이 PC 기준)

- git 2.55가 `C:\Program Files\Git\cmd`에 있습니다. 설치 전에 열린 셸은 PATH가 오래되어 `git`을 못 찾으니 `$env:Path = "C:\Program Files\Git\cmd;$env:Path"`를 앞에 붙이세요. 저장소 git identity는 `Codex <codex@local>`입니다.
- Docker와 Supabase CLI 로컬 스택이 없습니다. pgTAP은 작성만 하고, 실행은 Docker가 있는 환경에서 `npx supabase test db`로 합니다.
- 저장소 루트 `.env.local`, `.dev.vars`에 운영 Supabase 프로젝트 `mehhrnbaiojivesnobpv` 자격증명이 있습니다. 커밋 금지. `SUPABASE_SECRET_KEY`, `SUPABASE_MANAGEMENT_TOKEN`, `CLOUDFLARE_API_TOKEN`은 Worker 전용입니다. 이전 계획에 남은 `kctewzpeymlncibgyosz`를 운영 대상으로 사용하지 마세요.
- 격리 Git 워크트리는 `.env.local`을 자동으로 공유하지 않습니다. 그 워크트리에서 Vite 운영 빌드나 `npm run deploy`를 실행하기 전에 루트의 커밋 제외 `.env.local`을 워크트리 루트로 복사하거나 같은 `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`를 환경변수로 주입하세요. 빌드 후 생성 자산에 프로젝트 ID `mehhrnbaiojivesnobpv`가 포함됐는지 확인한 다음 배포해야 합니다.
- 회사·사업장과 거래처 스키마는 2026-09-14 운영 프로젝트에 적용됐지만 CLI migration history는 아직 복구되지 않았습니다. 거래처 `20260914000200`은 SQL Editor로 직접 적용했고, `supabase_migrations.schema_migrations` 조회 시 테이블이 없었습니다. 현재 토큰으로 프로젝트 link는 성공했으나 CLI login-role 초기화가 HTTP 403으로 막혀 `migration list`/repair를 완료하지 못했습니다.
- 권한 있는 운영자가 실제 카탈로그와 각 로컬 파일을 대조한 뒤, 이미 적용된 버전마다 공식 `npx supabase migration repair --status applied <VERSION>`을 실행하고 `npx supabase migration list --linked`의 local/remote 일치를 확인해야 합니다. 그 전에는 운영 프로젝트에 `npx supabase db push`를 실행하지 마세요. 원격 migration ledger를 수동으로 만들거나 행을 직접 삽입해서는 안 됩니다.
- 커밋 메시지에 한글이나 여러 줄이 필요하면 파일로 써서 `git commit -F <file>`을 쓰세요. PowerShell here-string을 `-F -`로 넘기면 stdin이 비어 실패합니다.

## 6. 결정 사항과 미결 사항

**결정됨**
- 다회사 · 다사업장 (2026-09-14, 사용자 확정). 대시보드의 두 회사 필터는 이제 기준정보에서 나옵니다.
- 고객 · 공급처는 거래처 기준정보 `master.partners`로 통합 (2026-09-14, 사용자 확정). 업무 화면은 거래처 원장을 조회·선택합니다.
- 삭제 대신 비활성화. 기준정보 코드는 등록 후 불변.
- `/approvals` 라우트에 `roles` 없음. 메뉴 권한 = 조회, 역할 = 처리.
- 상태 값은 영문 코드 저장, 한글 라벨 표시.
- HR/급여는 ERP 메뉴에서 제외(기존 설계 문서 결정).

**미결 (사용자 확인 필요)**
- 품목 메뉴 통합: `inventory.items` / `master.items`. 권장안은 `master.items`에서 원장을 관리하고 재고 업무 화면에서는 조회·선택만 하는 것. 통합할 때 `src/data/erp.js`와 `role_menu_permissions` 권한 키를 함께 이전해야 합니다.
- 전자세금계산서 발행 방식(국세청 직접 연동 vs ASP). 회계 단계 전에 결정.

## 7. 다음 할 일

체크박스는 완료 시 표시하고 이 문서를 같은 커밋에 포함하세요.

### 7.1 즉시 (운영, 사용자 또는 자격증명이 있는 작업자)

- [x] 호스팅 Supabase에 `companies`/`sites` 마이그레이션 적용. `tables_exist`, `rls_enabled`, `no_delete_grant`, `six_rls_policies`, `four_triggers`, `security_functions`, `tables_empty` 카탈로그 점검이 모두 `true`.
- [x] 운영 프로젝트 `mehhrnbaiojivesnobpv`에 `partners` 마이그레이션 적용. table/RLS, 최소 권한, 정책 3개, 트리거 2개, 제약·인덱스, 보안 함수, 레거시 권한 키 제거, 관리자 보호 트리거 복원, 빈 테이블 점검이 모두 `true`.
- [ ] 권한 있는 Supabase 토큰으로 수동 적용된 모든 마이그레이션을 카탈로그와 대조한 뒤 `migration repair --status applied`로 CLI 이력을 복구하고 `migration list --linked` 일치 확인. 현재 login-role 초기화 403으로 중단됨. 완료 전 `db push` 금지.
- [ ] 관리자 Google Authenticator 등록을 완료한 뒤 `/settings/company`에서 회사 1개와 사업장 1개가 등록되는지 확인. 현재 운영 브라우저는 MFA 등록 화면에서 해당 경로로 리다이렉트하도록 열려 있음.
- [ ] `user` 역할로 `/settings/company`의 등록·수정·비활성화 버튼이 숨겨지는지 운영 화면에서 확인. 마운트 테스트에서는 조회 전용 동작 통과.
- [ ] 관리자 MFA 인증 후 `/master/partners`에서 고객·공급업체·겸용 거래처 등록, 수정, 비활성/활성 전환을 운영 확인.
- [ ] `user` 역할로 `/master/partners`의 등록·수정·상태 전환 버튼이 숨겨지는지 운영 확인. 마운트 테스트에서는 조회 전용 동작 통과.
- [x] 운영 브라우저에서 두 레거시 경로 확인. 비로그인 상태에서 `/sales/customers`, `/purchasing/vendors` 모두 `/auth/login?redirect=/master/partners`로 끝나 통합 경로를 보존함. PWA 업데이트 적용 완료, 브라우저 개발 로그 비어 있음.
- [ ] Docker가 있는 환경에서 `npx supabase test db` 실행. 기대: `companies_sites_rls.test.sql` 35개와 `partners_rls.test.sql` 38개 통과.
- [x] Cloudflare Worker 최종 배포 (`61f5266c-d201-48c9-940a-eeb22fc7de05`, `index-Cbfjxbkr.js`). `/api/health` HTTP 200, Supabase `configured`; 레거시 2경로, 통합 경로, manifest, service worker HTTP 200.
- [ ] 최종 전체 브랜치 검토 후 `git push origin main` 및 로컬/원격 HEAD 일치 확인.

### 7.2 1단계 기준정보 마무리

**Task A: 중복 메뉴 통합**
- [x] 고객·공급처를 `master.partners`로 통합하고 레거시 URL/권한 키 이전.
- [ ] 품목 `inventory.items` / `master.items` 통합 여부 확정 후 같은 방식으로 메뉴·권한 키 이전.

**Task B: 거래처(partners) 기준정보**
- [x] 도메인, demo/Supabase 리포지토리, 스토어, 관리 화면, 마이그레이션, 텍스트 계약 테스트와 pgTAP 작성.
- [x] 운영 마이그레이션과 Worker 배포.
- [ ] 관리자 MFA와 일반 사용자 계정으로 실제 역할별 동작 확인.

**Task C: 품목(items) 기준정보**
- 테이블 `public.items`: `company_id`, `code`, `name`, `item_type enum(raw_material, semi_finished, finished_good, consumable, service)`, `unit text`(EA, KG, M 등), `safety_stock numeric(18,3) default 0`, `standard_price numeric(18,0) default 0`, `is_active`, 감사 컬럼. `(company_id, code)` 유일.
- 기존 `inventoryRows`(`src/data/erp.js`)의 코드 체계 `RM-`, `FG-`, `PK-`를 시드/데모에 반영. `stockStatusFor()`가 `safety_stock`을 쓰도록 연결.
- 커밋: `feat: add item master data`.

**Task D: 창고(warehouses) 기준정보**
- 테이블 `public.warehouses`: `company_id`, `site_id → sites`, `code`, `name`, `warehouse_type enum(raw_material, finished_good, packaging, general)`, `is_active`, 감사 컬럼. 사업장이 비활성이면 활성 창고 금지(`enforce_site_company_active` 패턴 재사용).
- 커밋: `feat: add warehouse master data`.

**Task E: 계정과목(accounts) 기준정보**
- 테이블 `public.accounts`: `company_id`, `code`(숫자 코드 허용하려면 형식 제약 별도), `name`, `account_type enum(asset, liability, equity, revenue, expense)`, `parent_id`(자기 참조, 계층), `is_postable boolean`, `is_active`. 한국 표준 계정과목 시드는 선택.
- 커밋: `feat: add chart of accounts master data`.

**Task F: 감사 로그**
- 테이블 `public.audit_logs(id, table_name, record_id, action, actor_id, changed_at, old_data jsonb, new_data jsonb)`. 범용 트리거 `private.record_audit()`를 `companies`, `sites`, 이후 모든 업무 테이블에 부착. 조회는 `is_admin()`만. 화면 `src/views/admin/AuditLogs.vue` (`/settings/audit`, 메뉴 키 `settings.audit`): 기간/테이블/작업자 필터, old/new diff 표시.
- 커밋: `feat: add audit log table and administrator screen`.

**Task G: 서버 측 문서 채번**
- `public.document_sequences(company_id, doc_type, period_key, last_number)`와 `private.next_document_number(company_id, doc_type, date)` 함수(`SO-YYMMDD-NNN`). 동시성은 행 잠금(`for update`). `src/data/erp.js`의 `nextOrderNumber()`는 데모 전용으로 남김.
- 커밋: `feat: add server-side document numbering`.

### 7.3 2단계 영업 · 구매 · 재고

- [ ] **수주 영속화**: `sales_orders(company_id, site_id, partner_id, number, order_date, due_date, status, total_amount, ...)` + `sales_order_lines(order_id, item_id, quantity, unit_price, amount)`. `supabaseErpRepository.js`를 `src/repositories/erp/`에 추가하고 `index.js`에서 `createDefaultMasterRepository`와 같은 선택 로직을 도입. 스토어 `src/stores/erp.js`는 이미 비동기 계약을 쓰므로 화면 변경은 최소. 수주 신규 등록 시 상태는 `ORDER_STATUS.PENDING_APPROVAL`로 강제하고 대화상자의 상태 선택은 수정 모드에만 노출.
- [ ] **결재 요청 테이블**: `approval_requests(company_id, doc_type, doc_id, title, amount, requester_id, status, decided_by, decided_at)`. 승인/반려 RPC가 `approver`/`admin`만 허용하고 원본 문서 상태를 함께 바꿈. 이 시점에 `Approvals.vue`의 클라이언트 권한 체크가 서버 강제로 뒷받침됨.
- [ ] **발주/입고**: `purchase_orders` + lines, `goods_receipts` → 재고 증가.
- [ ] **재고 트랜잭션 원장**: `stock_movements(company_id, warehouse_id, item_id, movement_type, quantity, ref_doc_type, ref_doc_id)`. 재고 현황은 집계 뷰. `InventoryStock.vue`가 `inventoryRows`를 직접 import 하는 것을 스토어 경유로 교체.
- [ ] 각 모듈에 전용 화면이 생기면 `GenericModule.vue`의 플레이스홀더 5행 생성 로직을 제거.

### 7.4 3단계 이후 (순서대로)

회계(전표, AR/AP, 마감, 재무제표), 부가세 및 세금계산서(외부 연동 결정 필요), 생산(BOM, 작업지시, 품질), 보고서 실데이터화(`getDashboardSnapshot()` 교체), 알림(발송 provider 필요), 첨부(R2), 백업(R2, 설계 문서상 보류 항목).

### 7.5 알려진 부채

- 대시보드 수치는 `getDashboardSnapshot()`의 계수 곱셈이며 회사/사업장 이름 문자열로 계수를 찾습니다. 데모 시드 이름(`넥서스 제조`, `넥서스 유통`, `서울 본사`, `인천 공장`, `부산 물류센터`)과만 맞습니다.
- `InventoryStock.vue`, `BestSellingWidget.vue`, `FinanceSummary.vue`는 데이터 파일을 직접 import 합니다.
- `GenericModule.vue`는 화면에서 데모 5행을 만들어 붙입니다. 실제 리포지토리가 연결되면 함께 표시되므로 전용 화면 전환 시 제거해야 합니다.
- 수주 신규 등록 대화상자에서 상태를 임의로 고를 수 있습니다.
- 프로덕션 번들의 주 청크가 약 970KB입니다(PrimeVue, Chart.js). 코드 스플리팅 미적용. 기능 개발과 무관한 성능 부채.
- `dist/`, `.cache/`는 gitignore 대상이며 빌드/테스트 산출물입니다.

## 8. 주요 파일 지도

```
src/data/erp.js                 메뉴 정의(menuKey), 데모 행, 대시보드 계수, 결재 권한 역할
src/data/status.js              상태 코드 테이블과 전이 규칙
src/data/master.js              회사·사업장 도메인 규칙
src/repositories/erp/           수주·결재·업무 기록 계약 (demo만 존재)
src/repositories/master/        회사·사업장 계약, demo + supabase 구현, 에러 매핑
src/repositories/access/        역할별 메뉴 권한 (supabase)
src/stores/auth.js              세션, 프로필, MFA, hasRole
src/stores/access.js            메뉴 권한 캐시, canAccess
src/stores/erp.js               데모 업무 데이터 캐시 (비동기, 전이 검증)
src/stores/master.js            회사·사업장 캐시
src/router/index.js             dedicatedViews 매핑, 나머지는 GenericModule
src/router/authGuard.js         설정→로그인→활성→MFA→역할→메뉴키 순 가드
src/views/master/CompanySites.vue   기준정보 화면의 참고 구현
src/views/admin/*               관리자 화면 (Worker API 사용)
worker/                         /api/me, /api/admin/*, /api/health
supabase/migrations/            SQL 마이그레이션 + 텍스트 계약 테스트(.test.js)
supabase/tests/                 pgTAP (.test.sql)
docs/setup/                     운영/설치 문서 (setup-docs.test.js가 명령어 존재를 검사)
docs/superpowers/               이전 설계 문서와 실행 계획 (specs/, plans/)
```
