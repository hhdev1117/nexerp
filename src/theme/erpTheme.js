import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

export const erpThemePreset = definePreset(Aura, {
    semantic: {
        colorScheme: {
            light: {
                primary: {
                    color: '{primary.700}',
                    contrastColor: '#ffffff',
                    hoverColor: '{primary.800}',
                    activeColor: '{primary.900}'
                },
                highlight: {
                    background: '{primary.50}',
                    focusBackground: '{primary.100}',
                    color: '{primary.700}',
                    focusColor: '{primary.800}'
                }
            }
        }
    }
});

export const koPrimeVueLocale = {
    startsWith: '시작 문자 일치',
    contains: '포함',
    notContains: '포함하지 않음',
    endsWith: '끝 문자 일치',
    equals: '같음',
    notEquals: '같지 않음',
    noFilter: '필터 없음',
    clear: '초기화',
    apply: '적용',
    accept: '예',
    reject: '아니요',
    choose: '선택',
    upload: '업로드',
    cancel: '취소',
    completed: '완료',
    pending: '대기',
    emptyFilterMessage: '검색 결과가 없습니다',
    emptySearchMessage: '검색 결과가 없습니다',
    emptyMessage: '선택 가능한 항목이 없습니다',
    selectionMessage: '{0}개 항목 선택됨',
    emptySelectionMessage: '선택된 항목 없음',
    aria: {
        trueLabel: '참',
        falseLabel: '거짓',
        nullLabel: '선택 안 함',
        selectAll: '모든 항목 선택됨',
        unselectAll: '모든 항목 선택 해제됨',
        close: '닫기',
        previous: '이전',
        next: '다음',
        navigation: '탐색',
        pageLabel: '{page}페이지',
        firstPageLabel: '첫 페이지',
        lastPageLabel: '마지막 페이지',
        nextPageLabel: '다음 페이지',
        prevPageLabel: '이전 페이지',
        rowsPerPageLabel: '페이지당 행 수',
        jumpToPageDropdownLabel: '이동할 페이지 선택',
        jumpToPageInputLabel: '이동할 페이지 입력',
        selectRow: '행 선택됨',
        unselectRow: '행 선택 해제됨',
        expandRow: '행 펼쳐짐',
        collapseRow: '행 접힘'
    }
};
