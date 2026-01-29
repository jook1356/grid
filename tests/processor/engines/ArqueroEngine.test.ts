/**
 * ArqueroEngine 단위 테스트
 *
 * Arquero 엔진의 기본 동작을 테스트합니다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArqueroEngine } from '../../../src/processor/engines/ArqueroEngine';
import { generateTestData, TestRow } from '../../fixtures/generateTestData';

describe('ArqueroEngine', () => {
  let engine: ArqueroEngine;
  let testData: TestRow[];

  beforeEach(async () => {
    engine = new ArqueroEngine();
    testData = generateTestData(1000);
    await engine.loadData(testData);
  });

  afterEach(async () => {
    await engine.cleanup();
  });

  // ===========================================================================
  // 초기화 테스트
  // ===========================================================================

  describe('초기화', () => {
    it('ArqueroEngine 인스턴스 생성', () => {
      expect(engine).toBeDefined();
      expect(engine).toBeInstanceOf(ArqueroEngine);
    });

    it('데이터 로드 후 행 수 확인', () => {
      expect(engine.getRowCount()).toBe(1000);
    });

    it('컬럼 키 목록 확인', () => {
      const columnKeys = engine.getColumnKeys();
      expect(columnKeys).toContain('id');
      expect(columnKeys).toContain('name');
      expect(columnKeys).toContain('age');
      expect(columnKeys).toContain('department');
    });
  });

  // ===========================================================================
  // 필터 테스트
  // ===========================================================================

  describe('filter', () => {
    it('숫자 필터 (gte)', async () => {
      const result = await engine.filter([
        { columnKey: 'age', operator: 'gte', value: 50 },
      ]);

      expect(result.indices.length).toBeGreaterThan(0);
      expect(result.indices.length).toBeLessThan(1000);
      expect(result.filteredCount).toBe(result.indices.length);

      // 필터 결과 검증
      const indices = Array.from(result.indices.slice(0, 10));
      const rows = await engine.getRows(indices);
      for (const row of rows) {
        expect(row.age).toBeGreaterThanOrEqual(50);
      }
    });

    it('숫자 필터 (lt)', async () => {
      const result = await engine.filter([
        { columnKey: 'age', operator: 'lt', value: 30 },
      ]);

      const indices = Array.from(result.indices.slice(0, 10));
      const rows = await engine.getRows(indices);
      for (const row of rows) {
        expect(row.age).toBeLessThan(30);
      }
    });

    it('문자열 필터 (eq)', async () => {
      const result = await engine.filter([
        { columnKey: 'department', operator: 'eq', value: 'Engineering' },
      ]);

      const indices = Array.from(result.indices.slice(0, 10));
      const rows = await engine.getRows(indices);
      for (const row of rows) {
        expect(row.department).toBe('Engineering');
      }
    });

    it('문자열 필터 (contains)', async () => {
      const result = await engine.filter([
        { columnKey: 'name', operator: 'contains', value: '김' },
      ]);

      const indices = Array.from(result.indices.slice(0, 10));
      const rows = await engine.getRows(indices);
      for (const row of rows) {
        expect(row.name).toContain('김');
      }
    });

    it('다중 필터 (AND)', async () => {
      const result = await engine.filter([
        { columnKey: 'age', operator: 'gte', value: 30 },
        { columnKey: 'department', operator: 'eq', value: 'Engineering' },
      ]);

      const indices = Array.from(result.indices.slice(0, 10));
      const rows = await engine.getRows(indices);
      for (const row of rows) {
        expect(row.age).toBeGreaterThanOrEqual(30);
        expect(row.department).toBe('Engineering');
      }
    });

    it('빈 필터 배열은 전체 데이터 반환', async () => {
      const result = await engine.filter([]);
      expect(result.indices.length).toBe(1000);
      expect(result.totalCount).toBe(1000);
    });
  });

  // ===========================================================================
  // 정렬 테스트
  // ===========================================================================

  describe('sort', () => {
    it('단일 컬럼 오름차순 정렬', async () => {
      const result = await engine.sort([
        { columnKey: 'age', direction: 'asc' },
      ]);

      const indices = Array.from(result.indices.slice(0, 10));
      const rows = await engine.getRows(indices);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i - 1]!.age).toBeLessThanOrEqual(rows[i]!.age);
      }
    });

    it('단일 컬럼 내림차순 정렬', async () => {
      const result = await engine.sort([
        { columnKey: 'salary', direction: 'desc' },
      ]);

      const indices = Array.from(result.indices.slice(0, 10));
      const rows = await engine.getRows(indices);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i - 1]!.salary).toBeGreaterThanOrEqual(rows[i]!.salary);
      }
    });

    it('다중 컬럼 정렬', async () => {
      const result = await engine.sort([
        { columnKey: 'department', direction: 'asc' },
        { columnKey: 'age', direction: 'desc' },
      ]);

      const indices = Array.from(result.indices.slice(0, 100));
      const rows = await engine.getRows(indices);

      // 부서별로 그룹화되어야 함
      let lastDept = '';
      let lastAge = Infinity;

      for (const row of rows) {
        if (row.department !== lastDept) {
          lastDept = row.department;
          lastAge = Infinity; // 새 부서면 나이 리셋
        }
        expect(row.age).toBeLessThanOrEqual(lastAge);
        lastAge = row.age;
      }
    });

    it('빈 정렬 배열은 원본 순서 유지', async () => {
      const result = await engine.sort([]);
      expect(result.indices.length).toBe(1000);
      expect(result.indices[0]).toBe(0);
      expect(result.indices[1]).toBe(1);
    });
  });

  // ===========================================================================
  // query 테스트
  // ===========================================================================

  describe('query', () => {
    it('필터 + 정렬 조합', async () => {
      const result = await engine.query({
        filters: [{ columnKey: 'age', operator: 'gte', value: 40 }],
        sorts: [{ columnKey: 'salary', direction: 'desc' }],
      });

      expect(result.indices.length).toBeGreaterThan(0);
      expect(result.indices.length).toBeLessThan(1000);

      const indices = Array.from(result.indices.slice(0, 10));
      const rows = await engine.getRows(indices);

      // 필터 검증
      for (const row of rows) {
        expect(row.age).toBeGreaterThanOrEqual(40);
      }

      // 정렬 검증
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i - 1]!.salary).toBeGreaterThanOrEqual(rows[i]!.salary);
      }
    });
  });

  // ===========================================================================
  // 집계 테스트
  // ===========================================================================

  describe('aggregate', () => {
    it('count 집계', async () => {
      const result = await engine.aggregate({
        groupBy: ['department'],
        aggregates: [{ columnKey: 'id', function: 'count', alias: 'cnt' }],
      });

      expect(result.length).toBeGreaterThan(0);

      // 모든 그룹의 count 합이 전체 행 수와 같아야 함
      const totalCount = result.reduce((sum, r) => sum + r.count, 0);
      expect(totalCount).toBe(1000);
    });

    it('sum 집계', async () => {
      const result = await engine.aggregate({
        groupBy: ['department'],
        aggregates: [{ columnKey: 'salary', function: 'sum', alias: 'totalSalary' }],
      });

      expect(result.length).toBeGreaterThan(0);
      for (const r of result) {
        expect(typeof r.aggregates.totalSalary).toBe('number');
        expect(r.aggregates.totalSalary as number).toBeGreaterThan(0);
      }
    });

    it('avg 집계', async () => {
      const result = await engine.aggregate({
        groupBy: ['department'],
        aggregates: [{ columnKey: 'age', function: 'avg', alias: 'avgAge' }],
      });

      expect(result.length).toBeGreaterThan(0);
      for (const r of result) {
        expect(typeof r.aggregates.avgAge).toBe('number');
        expect(r.aggregates.avgAge as number).toBeGreaterThanOrEqual(22);
        expect(r.aggregates.avgAge as number).toBeLessThanOrEqual(60);
      }
    });

    it('min/max 집계', async () => {
      const result = await engine.aggregate({
        groupBy: ['department'],
        aggregates: [
          { columnKey: 'age', function: 'min', alias: 'minAge' },
          { columnKey: 'age', function: 'max', alias: 'maxAge' },
        ],
      });

      expect(result.length).toBeGreaterThan(0);
      for (const r of result) {
        const minAge = r.aggregates.minAge as number;
        const maxAge = r.aggregates.maxAge as number;
        expect(minAge).toBeLessThanOrEqual(maxAge);
      }
    });
  });

  // ===========================================================================
  // 데이터 조회 테스트
  // ===========================================================================

  describe('데이터 조회', () => {
    it('getRows()로 특정 인덱스 행 가져오기', async () => {
      const rows = await engine.getRows([0, 1, 2]);
      expect(rows.length).toBe(3);
      expect(rows[0]!.id).toBe(1);
      expect(rows[1]!.id).toBe(2);
      expect(rows[2]!.id).toBe(3);
    });

    it('getAllRows()로 전체 데이터 가져오기', async () => {
      const allRows = await engine.getAllRows();
      expect(allRows.length).toBe(1000);
    });

    it('getUniqueValues()로 유니크 값 가져오기', async () => {
      const uniqueDepts = await engine.getUniqueValues('department');
      expect(uniqueDepts.length).toBeLessThanOrEqual(10); // 부서는 10개 이하
      expect(uniqueDepts).toContain('Engineering');
    });
  });

  // ===========================================================================
  // 정리 테스트
  // ===========================================================================

  describe('cleanup', () => {
    it('cleanup() 호출 후 데이터 초기화', async () => {
      await engine.cleanup();
      expect(engine.getRowCount()).toBe(0);
      expect(engine.getColumnKeys()).toEqual([]);
    });
  });
});
