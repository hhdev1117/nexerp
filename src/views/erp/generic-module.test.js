import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./GenericModule.vue', import.meta.url)), 'utf8');

describe('generic ERP module interactions', () => {
    it('opens a real form and inserts a validated record', () => {
        expect(source).toContain('v-model:visible="recordDialog"');
        expect(source).toContain('@submit.prevent="saveRecord"');
        expect(source).toContain('addGenericRecord(route.path');
        expect(source).toContain(':invalid="submitted && !record.subject.trim()"');
        expect(source).toContain('<Select inputId="generic-status"');
        expect(source).toContain('aria-labelledby="generic-status-label"');
        expect(source).toContain('aria-label="업무 검색"');
        expect(source).toContain('aria-label="업무 상태 필터"');
        expect(source).toContain('<h1');
        expect(source).toContain('aria-describedby="generic-subject-error"');
        expect(source).toContain('role="alert"');
        expect(source).toContain("document.getElementById('generic-subject')?.focus()");
        expect(source).toContain('v-model:visible="detailDialog"');
        expect(source).toContain('selectedRow.value = row');
        expect(source).toContain(':aria-label="`${slotProps.data.id} 상세 보기`"');
        expect(source).toContain('getGenericRecords(route.path)');
        expect(source).toContain('addGenericRecord(route.path');
        expect(source).not.toContain('createdRows.value = []');
        expect(source).toContain(':tableProps="{ \'aria-label\': `${moduleDefinition.title} 목록` }"');
        expect(source).toContain('autofocus required aria-describedby="generic-subject-error"');
        expect(source).toContain('<form class="flex flex-col gap-5" novalidate');
        expect(source).toContain('scrollable');
        expect(source).toContain('<Column header="작업" frozen alignFrozen="right"');
    });
});
