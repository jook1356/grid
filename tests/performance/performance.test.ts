/**
 * 성능 테스트
 *
 * 다양한 데이터 크기에서 각 작업의 성능을 측정하고
 * 결과를 파일로 저장합니다.
 */

import '@vitest/web-worker';
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GridCore } from '../../src/core/GridCore';
import { generateTestData, getTestColumns, TestRow } from '../fixtures/generateTestData';

// ESM 환경에서 __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// 성능 측정 결과 저장
// =============================================================================

interface PerformanceResult {
  testName: string;
  dataSize: number;
  operation: string;
  durationMs: number;
  timestamp: string;
}

const performanceResults: PerformanceResult[] = [];

/**
 * 성능 측정 헬퍼
 */
async function measurePerformance<T>(
  testName: string,
  dataSize: number,
  operation: string,
  fn: () => Promise<T> | T
): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;

  performanceResults.push({
    testName,
    dataSize,
    operation,
    durationMs: Math.round(duration * 100) / 100,
    timestamp: new Date().toISOString(),
  });

  return result;
}

/**
 * 결과를 파일로 저장
 */
function saveResults(): void {
  const resultsDir = path.join(__dirname, '..', 'results');

  // 디렉토리 생성 (없으면)
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `performance-${timestamp}.json`;
  const filePath = path.join(resultsDir, filename);

  // JSON 저장
  fs.writeFileSync(filePath, JSON.stringify(performanceResults, null, 2));
  console.log(`\n📊 성능 테스트 결과 저장: ${filePath}`);

  // 콘솔에 요약 출력
  printSummary();
}

/**
 * 요약 출력
 */
function printSummary(): void {
  console.log('\n=== 성능 테스트 요약 ===\n');

  // 데이터 크기별로 그룹화
  const grouped = new Map<number, PerformanceResult[]>();
  for (const result of performanceResults) {
    const list = grouped.get(result.dataSize) || [];
    list.push(result);
    grouped.set(result.dataSize, list);
  }

  // 크기별 출력
  for (const [size, results] of Array.from(grouped.entries()).sort((a, b) => a[0] - b[0])) {
    console.log(`📦 데이터 크기: ${size.toLocaleString()} 행`);
    for (const r of results) {
      console.log(`   ${r.operation}: ${r.durationMs}ms`);
    }
    console.log('');
  }
}

// =============================================================================
// 성능 테스트
// =============================================================================

describe('성능 테스트', () => {
  // 테스트할 데이터 크기
  const DATA_SIZES = [1_000, 10_000, 100_000, 1_000_000];

  // 모든 테스트 후 결과 저장
  afterAll(() => {
    saveResults();
  });

  describe.each(DATA_SIZES)('데이터 크기: %i 행', (dataSize) => {
    let grid: GridCore;
    let testData: TestRow[];

    it('데이터 생성', async () => {
      testData = await measurePerformance(
        `데이터 생성 (${dataSize})`,
        dataSize,
        '데이터 생성',
        () => generateTestData(dataSize)
      );

      expect(testData.length).toBe(dataSize);
    });

    it('GridCore 초기화 및 데이터 로드', async () => {
      grid = new GridCore({
        columns: getTestColumns(),
      });

      await measurePerformance(
        `GridCore 초기화 (${dataSize})`,
        dataSize,
        'GridCore 초기화',
        async () => {
          await grid.initialize();
        }
      );

      await measurePerformance(
        `데이터 로드 (${dataSize})`,
        dataSize,
        '데이터 로드',
        async () => {
          await grid.loadData(testData);
        }
      );

      expect(grid.getTotalRowCount()).toBe(dataSize);
    });

    it('단일 컬럼 정렬 (숫자)', async () => {
      await measurePerformance(
        `정렬 - 숫자 오름차순 (${dataSize})`,
        dataSize,
        '정렬 (숫자 오름차순)',
        async () => {
          await grid.sort([{ columnKey: 'age', direction: 'asc' }]);
        }
      );

      expect(grid.getVisibleRowCount()).toBe(dataSize);
    });

    it('단일 컬럼 정렬 (문자열)', async () => {
      await measurePerformance(
        `정렬 - 문자열 (${dataSize})`,
        dataSize,
        '정렬 (문자열)',
        async () => {
          await grid.sort([{ columnKey: 'name', direction: 'asc' }]);
        }
      );

      expect(grid.getVisibleRowCount()).toBe(dataSize);
    });

    it('다중 컬럼 정렬', async () => {
      await measurePerformance(
        `정렬 - 다중 컬럼 (${dataSize})`,
        dataSize,
        '정렬 (다중 컬럼)',
        async () => {
          await grid.sort([
            { columnKey: 'department', direction: 'asc' },
            { columnKey: 'salary', direction: 'desc' },
          ]);
        }
      );

      expect(grid.getVisibleRowCount()).toBe(dataSize);
    });

    it('필터 (숫자 범위)', async () => {
      // 먼저 정렬 초기화
      await grid.sort([]);

      await measurePerformance(
        `필터 - 숫자 범위 (${dataSize})`,
        dataSize,
        '필터 (숫자 범위)',
        async () => {
          await grid.filter([{ columnKey: 'age', operator: 'gte', value: 30 }]);
        }
      );

      expect(grid.getVisibleRowCount()).toBeLessThanOrEqual(dataSize);
      expect(grid.getVisibleRowCount()).toBeGreaterThan(0);
    });

    it('필터 (문자열 포함)', async () => {
      await measurePerformance(
        `필터 - 문자열 포함 (${dataSize})`,
        dataSize,
        '필터 (문자열 포함)',
        async () => {
          await grid.filter([{ columnKey: 'name', operator: 'contains', value: '김' }]);
        }
      );

      expect(grid.getVisibleRowCount()).toBeLessThanOrEqual(dataSize);
    });

    it('필터 + 정렬 조합', async () => {
      await measurePerformance(
        `필터 + 정렬 조합 (${dataSize})`,
        dataSize,
        '필터 + 정렬 조합',
        async () => {
          await grid.filter([
            { columnKey: 'age', operator: 'gte', value: 25 },
            { columnKey: 'department', operator: 'eq', value: 'Engineering' },
          ]);
          await grid.sort([{ columnKey: 'salary', direction: 'desc' }]);
        }
      );

      // 필터된 결과가 있어야 함
      expect(grid.getVisibleRowCount()).toBeLessThanOrEqual(dataSize);
    });

    it('getRowsInRange 성능', async () => {
      // 먼저 데이터 초기화
      await grid.clearFilters();
      await grid.sort([]);

      await measurePerformance(
        `getRowsInRange (${dataSize})`,
        dataSize,
        'getRowsInRange (100개)',
        () => {
          return grid.getRowsInRange(0, 100);
        }
      );
    });

    it('정리', () => {
      grid?.destroy();
    });
  });
});
