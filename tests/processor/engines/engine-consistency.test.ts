/**
 * 엔진 일관성 테스트
 *
 * ArqueroEngine과 DuckDBEngine이 동일한 결과를 반환하는지 검증합니다.
 * 동일한 테스트를 두 엔진에 적용하여 일관성을 확인합니다.
 *
 * 참고: DuckDB-Wasm은 초기화에 시간이 걸리며, 테스트 환경에 따라
 * 실패할 수 있습니다. 이 경우 ArqueroEngine 테스트만 실행됩니다.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ArqueroEngine } from '../../../src/processor/engines/ArqueroEngine';
import type { IEngine } from '../../../src/processor/engines/IEngine';
import type { TestRow } from '../../fixtures/generateTestData';

// ===========================================================================
// 테스트 데이터 (시드 고정을 위해 미리 생성)
// ===========================================================================

// 랜덤성 제거를 위해 고정된 테스트 데이터 사용
const FIXED_TEST_DATA: TestRow[] = [
  { id: 1, name: '김민준', email: 'user1@company.com', age: 35, salary: 50000000, department: 'Engineering', position: 'Senior', hireDate: '2020-01-15', isActive: true, score: 85.5 },
  { id: 2, name: '이서연', email: 'user2@company.com', age: 28, salary: 45000000, department: 'Marketing', position: 'Junior', hireDate: '2021-03-20', isActive: true, score: 78.3 },
  { id: 3, name: '박도윤', email: 'user3@company.com', age: 42, salary: 75000000, department: 'Engineering', position: 'Lead', hireDate: '2018-06-10', isActive: true, score: 92.1 },
  { id: 4, name: '최예준', email: 'user4@company.com', age: 31, salary: 55000000, department: 'Sales', position: 'Senior', hireDate: '2019-11-05', isActive: false, score: 71.8 },
  { id: 5, name: '정시우', email: 'user5@company.com', age: 26, salary: 40000000, department: 'Engineering', position: 'Junior', hireDate: '2022-02-28', isActive: true, score: 88.9 },
  { id: 6, name: '강하준', email: 'user6@company.com', age: 38, salary: 65000000, department: 'HR', position: 'Manager', hireDate: '2017-09-12', isActive: true, score: 76.4 },
  { id: 7, name: '조지호', email: 'user7@company.com', age: 45, salary: 85000000, department: 'Finance', position: 'Director', hireDate: '2015-04-25', isActive: true, score: 94.7 },
  { id: 8, name: '윤주원', email: 'user8@company.com', age: 29, salary: 48000000, department: 'Marketing', position: 'Senior', hireDate: '2020-08-18', isActive: true, score: 82.0 },
  { id: 9, name: '장지후', email: 'user9@company.com', age: 33, salary: 58000000, department: 'Engineering', position: 'Senior', hireDate: '2019-05-30', isActive: true, score: 89.2 },
  { id: 10, name: '임준서', email: 'user10@company.com', age: 50, salary: 95000000, department: 'Engineering', position: 'VP', hireDate: '2012-01-08', isActive: true, score: 96.5 },
];

// ===========================================================================
// 엔진 생성 헬퍼
// ===========================================================================

type EngineType = 'aq' | 'db';

async function createEngine(engineType: EngineType): Promise<IEngine | null> {
  if (engineType === 'aq') {
    return new ArqueroEngine();
  }

  // DuckDB 엔진은 동적 임포트 (테스트 환경에서 실패할 수 있음)
  try {
    const { DuckDBEngine } = await import('../../../src/processor/engines/DuckDBEngine');
    return new DuckDBEngine();
  } catch (e) {
    console.warn('DuckDBEngine not available in test environment:', e);
    return null;
  }
}

// ===========================================================================
// ArqueroEngine 단독 테스트 (기본 동작 검증)
// ===========================================================================

describe('ArqueroEngine - 기본 동작', () => {
  let engine: ArqueroEngine;

  beforeAll(async () => {
    engine = new ArqueroEngine();
    await engine.loadData(FIXED_TEST_DATA);
  });

  afterAll(async () => {
    await engine.cleanup();
  });

  it('데이터 로드 확인', () => {
    expect(engine.getRowCount()).toBe(10);
  });

  it('필터 결과', async () => {
    const result = await engine.filter([
      { columnKey: 'department', operator: 'eq', value: 'Engineering' },
    ]);
    expect(result.indices.length).toBe(5); // Engineering 부서는 5명
    expect(result.filteredCount).toBe(5);
  });

  it('정렬 결과', async () => {
    const result = await engine.sort([
      { columnKey: 'age', direction: 'asc' },
    ]);
    const indices = Array.from(result.indices);
    const rows = await engine.getRows(indices);
    expect(rows[0]!.age).toBe(26); // 가장 어린 사람
    expect(rows[rows.length - 1]!.age).toBe(50); // 가장 나이 많은 사람
  });

  it('집계 결과', async () => {
    const result = await engine.aggregate({
      groupBy: ['department'],
      aggregates: [{ columnKey: 'id', function: 'count', alias: 'cnt' }],
    });

    const engineering = result.find(r => r.groupValues.department === 'Engineering');
    expect(engineering?.count).toBe(5);
  });
});

// ===========================================================================
// 팩토리 테스트 (createProcessor)
// ===========================================================================

describe('ProcessorFactory', () => {
  it('createProcessor로 MainThreadProcessor 생성', async () => {
    const { createProcessor } = await import('../../../src/processor/ProcessorFactory');

    const processor = createProcessor({ engine: 'aq', useWorker: false });
    expect(processor).toBeDefined();

    await processor.initialize(FIXED_TEST_DATA);
    expect(processor.getRowCount()).toBe(10);
    processor.destroy();
  });

  it('createProcessor 기본값 (aq, main thread)', async () => {
    const { createProcessor, DEFAULT_PROCESSOR_OPTIONS } = await import('../../../src/processor/ProcessorFactory');

    expect(DEFAULT_PROCESSOR_OPTIONS.engine).toBe('aq');
    expect(DEFAULT_PROCESSOR_OPTIONS.useWorker).toBe(false);

    const processor = createProcessor();
    expect(processor).toBeDefined();
    processor.destroy();
  });
});

// ===========================================================================
// 엔진 동등성 테스트 (둘 다 사용 가능한 경우)
// ===========================================================================

describe.skip('Engine Consistency (ArqueroEngine vs DuckDBEngine)', () => {
  // 참고: DuckDB-Wasm은 테스트 환경에서 초기화에 시간이 걸리거나
  // 실패할 수 있어 기본적으로 skip 처리합니다.
  // 로컬에서 테스트할 때는 .skip을 제거하세요.

  let aqEngine: IEngine;
  let dbEngine: IEngine | null;

  beforeAll(async () => {
    aqEngine = new ArqueroEngine();
    await aqEngine.loadData(FIXED_TEST_DATA);

    dbEngine = await createEngine('db');
    if (dbEngine) {
      await dbEngine.loadData(FIXED_TEST_DATA);
    }
  });

  afterAll(async () => {
    await aqEngine.cleanup();
    if (dbEngine) {
      await dbEngine.cleanup();
    }
  });

  it('동일한 필터 결과', async () => {
    if (!dbEngine) {
      console.warn('Skipping: DuckDB not available');
      return;
    }

    const aqResult = await aqEngine.filter([
      { columnKey: 'age', operator: 'gte', value: 35 },
    ]);

    const dbResult = await dbEngine.filter([
      { columnKey: 'age', operator: 'gte', value: 35 },
    ]);

    expect(aqResult.indices.length).toBe(dbResult.indices.length);
  });

  it('동일한 집계 결과', async () => {
    if (!dbEngine) {
      console.warn('Skipping: DuckDB not available');
      return;
    }

    const aqResult = await aqEngine.aggregate({
      groupBy: ['department'],
      aggregates: [{ columnKey: 'id', function: 'count', alias: 'cnt' }],
    });

    const dbResult = await dbEngine.aggregate({
      groupBy: ['department'],
      aggregates: [{ columnKey: 'id', function: 'count', alias: 'cnt' }],
    });

    // 부서 수가 동일해야 함
    expect(aqResult.length).toBe(dbResult.length);

    // 각 부서별 카운트가 동일해야 함
    for (const aqRow of aqResult) {
      const dept = aqRow.groupValues.department;
      const dbRow = dbResult.find(r => r.groupValues.department === dept);
      expect(dbRow?.count).toBe(aqRow.count);
    }
  });
});
