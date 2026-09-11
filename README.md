# Sakai ERP Demo

PrimeFaces의 MIT 라이선스 [Sakai Vue](https://github.com/primefaces/sakai-vue)를 기반으로 만든 ERP 데모 템플릿입니다. 인사와 급여를 제외한 영업, 구매, 재고·물류, 생산, 회계·재무, 결재, 보고서, 기준정보 및 시스템 메뉴를 포함합니다.

## Run

```bash
npm install
npm run dev
```

## Verify

```bash
npm test -- --run
npm run build
```

## Structure

- `src/data/erp.js`: 메뉴, KPI, 상태, 샘플 데이터 계약
- `src/views/Dashboard.vue`: 통합 ERP 대시보드
- `src/views/erp/`: 핵심 업무 화면과 공통 모듈 화면
- `src/layout/`: Sakai 셸, 메뉴 애니메이션, 테마 설정
- `src/router/index.js`: 모든 ERP 메뉴의 라우트 매핑

라이트/다크 모드, 색상 프리셋, static/overlay 메뉴 모드는 Sakai 기본 설정 패널에서 변경할 수 있습니다.

## License

기반 템플릿의 저작권과 MIT 라이선스 고지는 `LICENSE.md`를 따릅니다.
