# 12회차: 그룹화 시 헤더 들여쓰기 동기화

## 이번 회차에서 구현한 내용

행 그룹화 기능 사용 시, 데이터 행의 들여쓰기와 헤더의 들여쓰기를 동기화하는 기능을 구현했습니다.

### 문제 상황

- 기존에는 그룹화된 데이터 행만 `groupPath.length`에 따라 들여쓰기가 적용됨
- 헤더는 들여쓰기가 없어서 데이터와 정렬이 맞지 않음

### 해결 방법: CSS 변수 활용

CSS 변수를 사용하여 헤더와 바디의 들여쓰기를 동기화했습니다.

```
┌─────────────────┐
│  GroupManager   │ ← getGroupColumns().length
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  GridRenderer   │ ← CSS 변수 설정
│  (또는 PureSheet)│    --ps-group-indent: 40px
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐  ┌─────────┐
│Header │  │  Body   │ ← padding-left: var(--ps-group-indent)
└───────┘  └─────────┘
```

## 생성/수정된 파일 목록

### 수정된 파일

1. **`src/ui/style/default.css`**
   - `--ps-group-indent` CSS 변수 추가 (기본값: 0px)
   - `--ps-group-indent-unit` CSS 변수 추가 (기본값: 20px)
   - `.ps-header-row .ps-cells-center`에 `padding-left: var(--ps-group-indent)` 적용

2. **`src/ui/GridRenderer.ts`**
   - `setGroupingConfig(config)` 메서드 추가
   - `updateGroupIndent(depth: number)` 메서드 추가
   - 초기화 시 그룹화 설정이 있으면 indent 자동 설정

4. **`src/ui/body/BodyRenderer.ts`**
   - `setGroupingConfig()` 내부에서 `updateGroupIndentCSS()` 자동 호출
   - `updateGroupIndentCSS(depth)` private 메서드 추가 - 상위 `.ps-grid-container`의 CSS 변수 직접 업데이트

3. **`src/ui/PureSheet.ts`**
   - `setGrouping(config: GroupingConfig | null)` 메서드 추가 - GridRenderer.setGroupingConfig() 호출
   - `groupBy(columns: string[])` 간편 API 추가
   - `clearGrouping()` 메서드 추가
   - `toggleGroup(groupId: string)` 메서드 추가
   - `expandAllGroups()` 메서드 추가
   - `collapseAllGroups()` 메서드 추가

## 핵심 개념 설명

### CSS 변수를 선택한 이유

1. **단일 진실의 원천**: 그룹 indent 값을 한 곳에서 관리
2. **자동 동기화**: HeaderRenderer와 BodyRenderer가 같은 변수 참조
3. **최소 변경**: 기존 코드 구조 유지, CSS만 추가
4. **성능**: JavaScript 연산 없이 CSS로 처리

### 들여쓰기 계산 방식

- **헤더**: `groupColumns.length × 20px` (최대 깊이)
- **데이터 행**: `groupPath.length × 20px` (해당 행의 깊이)

최대 깊이의 데이터 행과 헤더의 indent가 동일하므로 정렬이 맞습니다.

## 사용 예시

```typescript
// PureSheet 인스턴스 생성
const sheet = new PureSheet(container, {
  columns: [...],
  data: [...],
});

// 그룹화 설정 (country → city 순서로 계층 그룹화)
sheet.groupBy(['country', 'city']);
// → 헤더 indent: 40px (2 × 20px)
// → 최대 깊이 데이터 행 indent: 40px

// 그룹화 해제
sheet.clearGrouping();
// → 헤더 indent: 0px
```

## 다음 회차 예고

- 그룹화 집계(aggregates) 기능 개선
- 그룹 헤더 커스터마이징 옵션 추가
