/**
 * GridCore 테스트
 *
 * 주요 기능들을 테스트하고 성능을 측정합니다.
 */

import '@vitest/web-worker';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GridCore } from '../../src/core/GridCore';
import { generateTestData, getTestColumns, TestRow } from '../fixtures/generateTestData';

// =============================================================================
// 테스트 설정
// =============================================================================

describe('GridCore', () => {
  let grid: GridCore;
  let testData: TestRow[];

  // 각 테스트 전 설정
  beforeEach(() => {
    grid = new GridCore({
      columns: getTestColumns(),
    });
  });

  // 각 테스트 후 정리
  afterEach(() => {
    grid?.destroy();
  });

  // ===========================================================================
  // 초기화 테스트
  // ===========================================================================

  describe('초기화', () => {
    it('GridCore 인스턴스 생성', () => {
      expect(grid).toBeDefined();
      expect(grid).toBeInstanceOf(GridCore);
    });

    it('initialize() 호출 후 Worker 준비됨', async () => {
      await grid.initialize();
      // Worker가 준비되면 에러 없이 완료
      expect(true).toBe(true);
    });

    it('loadData() 호출 후 데이터 로드됨', async () => {
      await grid.initialize();
      testData = generateTestData(100);
      await grid.loadData(testData);

      expect(grid.getTotalRowCount()).toBe(100);
      expect(grid.getVisibleRowCount()).toBe(100);
    });
  });

  // ===========================================================================
  // 데이터 접근 테스트
  // ===========================================================================

  describe('데이터 접근', () => {
    beforeEach(async () => {
      await grid.initialize();
      testData = generateTestData(1000);
      await grid.loadData(testData);
    });

    it('getRowsInRange()로 범위 데이터 가져오기', () => {
      const rows = grid.getRowsInRange(0, 10);
      expect(rows.length).toBe(10);
      expect(rows[0]?.id).toBe(1);
    });

    it('getRowByVisibleIndex()로 단일 행 가져오기', () => {
      const row = grid.getRowByVisibleIndex(0);
      expect(row).toBeDefined();
      expect(row?.id).toBe(1);
    });

    it('getRowById()로 ID로 행 가져오기', () => {
      const row = grid.getRowById(50);
      expect(row).toBeDefined();
      expect(row?.id).toBe(50);
    });

    it('getAllData()로 전체 데이터 가져오기', () => {
      const allData = grid.getAllData();
      expect(allData.length).toBe(1000);
    });

    it('getColumns()로 컬럼 정의 가져오기', () => {
      const columns = grid.getColumns();
      expect(columns.length).toBe(10);
      expect(columns[0]?.key).toBe('id');
    });
  });

  // ===========================================================================
  // 정렬 테스트
  // ===========================================================================

  describe('정렬', () => {
    beforeEach(async () => {
      await grid.initialize();
      testData = generateTestData(1000);
      await grid.loadData(testData);
    });

    it('단일 컬럼 오름차순 정렬', async () => {
      await grid.sort([{ columnKey: 'age', direction: 'asc' }]);

      const rows = grid.getRowsInRange(0, 10);
      // 오름차순이므로 첫 번째가 가장 작아야 함
      for (let i = 1; i < rows.length; i++) {
        const prevRow = rows[i - 1];
        const currRow = rows[i];
        if (prevRow && currRow) {
          expect(prevRow.age).toBeLessThanOrEqual(currRow.age);
        }
      }
    });

    it('단일 컬럼 내림차순 정렬', async () => {
      await grid.sort([{ columnKey: 'age', direction: 'desc' }]);

      const rows = grid.getRowsInRange(0, 10);
      // 내림차순이므로 첫 번째가 가장 커야 함
      for (let i = 1; i < rows.length; i++) {
        const prevRow = rows[i - 1];
        const currRow = rows[i];
        if (prevRow && currRow) {
          expect(prevRow.age).toBeGreaterThanOrEqual(currRow.age);
        }
      }
    });

    it('다중 컬럼 정렬', async () => {
      await grid.sort([
        { columnKey: 'department', direction: 'asc' },
        { columnKey: 'age', direction: 'desc' },
      ]);

      const rows = grid.getRowsInRange(0, 100);
      // 부서별로 그룹화되어 있어야 함
      expect(rows.length).toBe(100);
    });

    it('정렬 토글', async () => {
      // 없음 → 오름차순
      await grid.toggleSort('name');
      expect(grid.getViewState().sorts[0]?.direction).toBe('asc');

      // 오름차순 → 내림차순
      await grid.toggleSort('name');
      expect(grid.getViewState().sorts[0]?.direction).toBe('desc');

      // 내림차순 → 없음
      await grid.toggleSort('name');
      expect(grid.getViewState().sorts.length).toBe(0);
    });

    it('정렬 해제', async () => {
      await grid.sort([{ columnKey: 'name', direction: 'asc' }]);
      expect(grid.getViewState().sorts.length).toBe(1);

      await grid.sort([]);
      expect(grid.getViewState().sorts.length).toBe(0);
    });
  });

  // ===========================================================================
  // 필터 테스트
  // ===========================================================================

  describe('필터', () => {
    beforeEach(async () => {
      await grid.initialize();
      testData = generateTestData(1000);
      await grid.loadData(testData);
    });

    it('숫자 필터 (gte)', async () => {
      await grid.filter([{ columnKey: 'age', operator: 'gte', value: 50 }]);

      const rows = grid.getRowsInRange(0, grid.getVisibleRowCount());
      for (const row of rows) {
        expect(row.age).toBeGreaterThanOrEqual(50);
      }
    });

    it('숫자 필터 (lt)', async () => {
      await grid.filter([{ columnKey: 'age', operator: 'lt', value: 30 }]);

      const rows = grid.getRowsInRange(0, grid.getVisibleRowCount());
      for (const row of rows) {
        expect(row.age).toBeLessThan(30);
      }
    });

    it('문자열 필터 (contains)', async () => {
      await grid.filter([{ columnKey: 'name', operator: 'contains', value: '김' }]);

      const rows = grid.getRowsInRange(0, grid.getVisibleRowCount());
      for (const row of rows) {
        expect(row.name).toContain('김');
      }
    });

    it('다중 필터 (AND)', async () => {
      await grid.filter([
        { columnKey: 'age', operator: 'gte', value: 30 },
        { columnKey: 'department', operator: 'eq', value: 'Engineering' },
      ]);

      const rows = grid.getRowsInRange(0, grid.getVisibleRowCount());
      for (const row of rows) {
        expect(row.age).toBeGreaterThanOrEqual(30);
        expect(row.department).toBe('Engineering');
      }
    });

    it('필터 추가', async () => {
      await grid.addFilter({ columnKey: 'age', operator: 'gte', value: 30 });
      expect(grid.getViewState().filters.length).toBe(1);

      await grid.addFilter({ columnKey: 'department', operator: 'eq', value: 'Engineering' });
      expect(grid.getViewState().filters.length).toBe(2);
    });

    it('필터 제거', async () => {
      await grid.filter([
        { columnKey: 'age', operator: 'gte', value: 30 },
        { columnKey: 'department', operator: 'eq', value: 'Engineering' },
      ]);

      await grid.removeFilter('age');
      expect(grid.getViewState().filters.length).toBe(1);
      expect(grid.getViewState().filters[0]?.columnKey).toBe('department');
    });

    it('모든 필터 해제', async () => {
      await grid.filter([
        { columnKey: 'age', operator: 'gte', value: 30 },
        { columnKey: 'department', operator: 'eq', value: 'Engineering' },
      ]);

      await grid.clearFilters();
      expect(grid.getViewState().filters.length).toBe(0);
      expect(grid.getVisibleRowCount()).toBe(1000);
    });
  });

  // ===========================================================================
  // 정렬 + 필터 조합 테스트
  // ===========================================================================

  describe('정렬 + 필터 조합', () => {
    beforeEach(async () => {
      await grid.initialize();
      testData = generateTestData(1000);
      await grid.loadData(testData);
    });

    it('필터 후 정렬', async () => {
      // 먼저 필터
      await grid.filter([{ columnKey: 'age', operator: 'gte', value: 40 }]);
      const filteredCount = grid.getVisibleRowCount();

      // 정렬
      await grid.sort([{ columnKey: 'salary', direction: 'desc' }]);

      // 필터된 개수는 유지되어야 함
      expect(grid.getVisibleRowCount()).toBe(filteredCount);

      // 정렬 확인
      const rows = grid.getRowsInRange(0, 10);
      for (let i = 1; i < rows.length; i++) {
        const prevRow = rows[i - 1];
        const currRow = rows[i];
        if (prevRow && currRow) {
          expect(prevRow.salary).toBeGreaterThanOrEqual(currRow.salary);
        }
      }
    });
  });

  // ===========================================================================
  // 이벤트 테스트
  // ===========================================================================

  describe('이벤트', () => {
    beforeEach(async () => {
      await grid.initialize();
      testData = generateTestData(100);
      await grid.loadData(testData);
    });

    it('indices:updated 이벤트 발생', async () => {
      let eventFired = false;
      let visibleCount = 0;

      grid.on('indices:updated', (event) => {
        eventFired = true;
        visibleCount = event.payload.visibleCount;
      });

      await grid.filter([{ columnKey: 'age', operator: 'gte', value: 50 }]);

      expect(eventFired).toBe(true);
      expect(visibleCount).toBeGreaterThan(0);
      expect(visibleCount).toBeLessThan(100);
    });

    it('view:changed 이벤트 발생', async () => {
      let eventFired = false;
      let changedProperty = '';

      grid.on('view:changed', (event) => {
        eventFired = true;
        changedProperty = event.payload.changedProperty;
      });

      await grid.sort([{ columnKey: 'name', direction: 'asc' }]);

      expect(eventFired).toBe(true);
      expect(changedProperty).toBe('sorts');
    });

    it('이벤트 구독 해제', async () => {
      let callCount = 0;

      const unsubscribe = grid.on('indices:updated', () => {
        callCount++;
      });

      await grid.filter([{ columnKey: 'age', operator: 'gte', value: 50 }]);
      expect(callCount).toBe(1);

      unsubscribe();

      await grid.filter([{ columnKey: 'age', operator: 'gte', value: 40 }]);
      expect(callCount).toBe(1); // 증가하지 않음
    });
  });
});
