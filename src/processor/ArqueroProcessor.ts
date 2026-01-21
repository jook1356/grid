/**
 * ArqueroProcessor - Arquero 기반 데이터 처리기
 *
 * Web Worker 내부에서 실행되며, 정렬/필터링/집계 등을 수행합니다.
 * IDataProcessor 인터페이스를 구현하여 다른 라이브러리로 교체 가능합니다.
 *
 * Arquero란?
 * - Observable에서 만든 JavaScript 데이터 처리 라이브러리
 * - Python pandas, R dplyr과 비슷한 API
 * - 컬럼 지향(Column-oriented) 저장으로 빠른 연산
 *
 * @example
 * const processor = new ArqueroProcessor();
 * await processor.initialize(data);
 *
 * const result = await processor.query({
 *   filters: [{ columnKey: 'age', operator: 'gte', value: 20 }],
 *   sorts: [{ columnKey: 'name', direction: 'asc' }]
 * });
 */

import * as aq from 'arquero';
import type { Table } from 'arquero';
import type { CellValue } from '../types';
import type {
  Row,
  ColumnDef,
  SortState,
  FilterState,
  IDataProcessor,
  ProcessorResult,
  QueryOptions,
  AggregateQueryOptions,
  AggregateResult,
} from '../types';

/**
 * 피봇 설정 옵션
 */
export interface PivotOptions {
  /** 행으로 유지될 필드 */
  rowFields: string[];
  /** 열로 펼쳐질 필드 */
  columnFields: string[];
  /** 값/집계 필드 */
  valueFields: {
    field: string;
    aggregate: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last';
    label?: string;
  }[];
  /** 필터 (선택) */
  filters?: FilterState[];
}

/**
 * 피봇 결과
 */
export interface PivotResult {
  /** 피봇된 행 데이터 */
  rows: Row[];
  /** 생성된 컬럼 정의 */
  columns: ColumnDef[];
  /** 동적 생성된 값 컬럼 키 목록 */
  generatedValueColumnKeys: string[];
}

/**
 * Arquero 기반 데이터 처리기
 */
export class ArqueroProcessor implements IDataProcessor {
  /**
   * Arquero 테이블 (컬럼 지향 데이터 구조)
   */
  private table: Table | null = null;

  /**
   * 원본 행 수
   */
  private rowCount: number = 0;

  // ==========================================================================
  // 초기화 / 정리
  // ==========================================================================

  /**
   * 데이터 초기화
   *
   * Row 배열을 Arquero Table로 변환합니다.
   * 이 변환은 최초 1회만 수행되며, 이후 연산은 Table에서 수행됩니다.
   *
   * @param data - 원본 데이터 배열
   */
  async initialize(data: Row[]): Promise<void> {
    this.rowCount = data.length;

    // Row 배열 → Arquero Table 변환
    // Arquero는 컬럼 지향으로 저장하여 연산 효율이 높음
    this.table = aq.from(data);

    // 원본 인덱스 컬럼 추가 (정렬/필터 후에도 원본 위치 추적용)
    // aq.op.row_number()는 1부터 시작하므로 -1 해서 0부터 시작하도록 함
    this.table = this.table.derive({
      __rowIndex__: () => aq.op.row_number() - 1,
    });
  }

  /**
   * 리소스 정리
   */
  destroy(): void {
    this.table = null;
    this.rowCount = 0;
  }

  /**
   * 초기화 여부 확인
   */
  private ensureInitialized(): Table {
    if (!this.table) {
      throw new Error('ArqueroProcessor not initialized. Call initialize() first.');
    }
    return this.table;
  }

  // ==========================================================================
  // 정렬
  // ==========================================================================

  /**
   * 정렬 수행
   *
   * @param sorts - 정렬 조건 배열 (다중 정렬 지원)
   * @returns 정렬된 인덱스 배열
   *
   * @example
   * // 이름 오름차순 → 나이 내림차순
   * const result = await processor.sort([
   *   { columnKey: 'name', direction: 'asc' },
   *   { columnKey: 'age', direction: 'desc' }
   * ]);
   */
  async sort(sorts: SortState[]): Promise<ProcessorResult> {
    const table = this.ensureInitialized();

    if (sorts.length === 0) {
      return this.extractIndices(table);
    }

    // 정렬 조건 변환
    // Arquero는 orderby()에 문자열 또는 aq.desc()를 받음
    const orderArgs = sorts.map((sort) =>
      sort.direction === 'desc' ? aq.desc(sort.columnKey) : sort.columnKey
    );

    const sorted = table.orderby(...orderArgs);
    return this.extractIndices(sorted);
  }

  // ==========================================================================
  // 필터링
  // ==========================================================================

  /**
   * 필터링 수행
   *
   * @param filters - 필터 조건 배열 (AND 조합)
   * @returns 필터를 통과한 인덱스 배열
   *
   * @example
   * // 나이 >= 20 AND 이름에 '김' 포함
   * const result = await processor.filter([
   *   { columnKey: 'age', operator: 'gte', value: 20 },
   *   { columnKey: 'name', operator: 'contains', value: '김' }
   * ]);
   */
  async filter(filters: FilterState[]): Promise<ProcessorResult> {
    const table = this.ensureInitialized();

    if (filters.length === 0) {
      return this.extractIndices(table);
    }

    let result = table;

    // 각 필터 조건을 순차적으로 적용 (AND 조합)
    for (const filter of filters) {
      result = this.applyFilter(result, filter);
    }

    return this.extractIndices(result);
  }

  /**
   * 단일 필터 적용
   */
  private applyFilter(table: Table, filter: FilterState): Table {
    const { columnKey, operator, value, value2 } = filter;

    // Arquero의 filter는 escape()를 사용해 외부 값 주입
    // d => d.columnKey > value 형태의 함수를 생성

    switch (operator) {
      case 'eq':
        return table.filter(aq.escape((d: Row) => d[columnKey] === value));

      case 'neq':
        return table.filter(aq.escape((d: Row) => d[columnKey] !== value));

      case 'gt':
        return table.filter(aq.escape((d: Row) => {
          const v = d[columnKey];
          return v !== null && v !== undefined && v > value!;
        }));

      case 'gte':
        return table.filter(aq.escape((d: Row) => {
          const v = d[columnKey];
          return v !== null && v !== undefined && v >= value!;
        }));

      case 'lt':
        return table.filter(aq.escape((d: Row) => {
          const v = d[columnKey];
          return v !== null && v !== undefined && v < value!;
        }));

      case 'lte':
        return table.filter(aq.escape((d: Row) => {
          const v = d[columnKey];
          return v !== null && v !== undefined && v <= value!;
        }));

      case 'contains':
        return table.filter(aq.escape((d: Row) => {
          const v = d[columnKey];
          return v !== null && v !== undefined && 
                 String(v).toLowerCase().includes(String(value).toLowerCase());
        }));

      case 'notContains':
        return table.filter(aq.escape((d: Row) => {
          const v = d[columnKey];
          return v === null || v === undefined || 
                 !String(v).toLowerCase().includes(String(value).toLowerCase());
        }));

      case 'startsWith':
        return table.filter(aq.escape((d: Row) => {
          const v = d[columnKey];
          return v !== null && v !== undefined && 
                 String(v).toLowerCase().startsWith(String(value).toLowerCase());
        }));

      case 'endsWith':
        return table.filter(aq.escape((d: Row) => {
          const v = d[columnKey];
          return v !== null && v !== undefined && 
                 String(v).toLowerCase().endsWith(String(value).toLowerCase());
        }));

      case 'between':
        return table.filter(aq.escape((d: Row) => {
          const v = d[columnKey];
          return v !== null && v !== undefined && 
                 v >= value! && v <= value2!;
        }));

      case 'isNull':
        return table.filter(aq.escape((d: Row) => {
          const v = d[columnKey];
          return v === null || v === undefined;
        }));

      case 'isNotNull':
        return table.filter(aq.escape((d: Row) => {
          const v = d[columnKey];
          return v !== null && v !== undefined;
        }));

      default:
        return table;
    }
  }

  // ==========================================================================
  // 복합 쿼리
  // ==========================================================================

  /**
   * 복합 쿼리 (필터 + 정렬)
   *
   * 개별 호출보다 효율적입니다 (중간 결과 생성 최소화).
   *
   * @param options - 쿼리 옵션
   * @returns 처리된 인덱스 배열
   */
  async query(options: QueryOptions): Promise<ProcessorResult> {
    const table = this.ensureInitialized();
    let result = table;

    // 1. 필터 적용 (먼저)
    if (options.filters && options.filters.length > 0) {
      for (const filter of options.filters) {
        result = this.applyFilter(result, filter);
      }
    }

    // 2. 정렬 적용 (나중)
    if (options.sorts && options.sorts.length > 0) {
      const orderArgs = options.sorts.map((sort) =>
        sort.direction === 'desc' ? aq.desc(sort.columnKey) : sort.columnKey
      );
      result = result.orderby(...orderArgs);
    }

    return this.extractIndices(result);
  }

  // ==========================================================================
  // 집계
  // ==========================================================================

  /**
   * 그룹화 + 집계
   *
   * @param options - 집계 옵션
   * @returns 그룹별 집계 결과
   *
   * @example
   * // 부서별 평균 급여, 최대 나이
   * const result = await processor.aggregate({
   *   groupBy: ['department'],
   *   aggregates: [
   *     { columnKey: 'salary', function: 'avg' },
   *     { columnKey: 'age', function: 'max' }
   *   ]
   * });
   */
  async aggregate(options: AggregateQueryOptions): Promise<AggregateResult[]> {
    let table = this.ensureInitialized();

    // 필터 먼저 적용
    if (options.filters && options.filters.length > 0) {
      for (const filter of options.filters) {
        table = this.applyFilter(table, filter);
      }
    }

    // 집계 스펙 생성
    const rollupSpec: Record<string, unknown> = {
      count: aq.op.count(),
    };

    for (const agg of options.aggregates) {
      const alias = agg.alias || `${agg.function}_${agg.columnKey}`;
      rollupSpec[alias] = this.getAggregateOp(agg.function, agg.columnKey);
    }

    // 그룹화 + 집계
    const grouped = table.groupby(...options.groupBy).rollup(rollupSpec);

    // 결과 변환
    const rows = grouped.objects() as Record<string, unknown>[];

    return rows.map((row) => {
      // groupValues 추출
      const groupValues: Record<string, CellValue> = {};
      for (const key of options.groupBy) {
        groupValues[key] = row[key] as CellValue;
      }

      // groupKey 생성
      const groupKey = options.groupBy.map((key) => String(row[key])).join('|');

      // aggregates 추출
      const aggregates: Record<string, CellValue> = {};
      for (const agg of options.aggregates) {
        const alias = agg.alias || `${agg.function}_${agg.columnKey}`;
        aggregates[alias] = row[alias] as CellValue;
      }

      return {
        groupKey,
        groupValues,
        aggregates,
        count: row['count'] as number,
      };
    });
  }

  /**
   * 집계 함수 변환
   */
  private getAggregateOp(func: string, columnKey: string): unknown {
    switch (func) {
      case 'sum':
        return aq.op.sum(columnKey);
      case 'avg':
        return aq.op.mean(columnKey);
      case 'min':
        return aq.op.min(columnKey);
      case 'max':
        return aq.op.max(columnKey);
      case 'count':
        return aq.op.count();
      case 'first':
        return aq.op.first(columnKey);
      case 'last':
        return aq.op.last(columnKey);
      default:
        return aq.op.count();
    }
  }

  // ==========================================================================
  // 피봇
  // ==========================================================================

  /**
   * 피봇 수행
   *
   * 데이터를 피봇하여 행↔열 변환을 수행합니다.
   * fold + groupby + 수동 집계 방식으로 구현 (Arquero pivot() 대신).
   *
   * @param options - 피봇 옵션
   * @returns 피봇 결과 (새로운 Row[] + ColumnDef[])
   *
   * @example
   * const result = await processor.pivot({
   *   rowFields: ['department'],
   *   columnFields: ['year', 'quarter'],
   *   valueFields: [{ field: 'sales', aggregate: 'sum' }]
   * });
   */
  async pivot(options: PivotOptions): Promise<PivotResult> {
    let table = this.ensureInitialized();

    // 필터 먼저 적용
    if (options.filters && options.filters.length > 0) {
      for (const filter of options.filters) {
        table = this.applyFilter(table, filter);
      }
    }

    const { rowFields, columnFields, valueFields } = options;

    // 원본 데이터를 객체 배열로 변환
    const data = table.objects() as Row[];

    // 피봇 키 생성 함수 (여러 컬럼 필드를 하나의 키로 합침)
    const getPivotKey = (row: Row): string => {
      return columnFields.map((f) => String(row[f] ?? '')).join('_');
    };

    // 행 키 생성 함수
    const getRowKey = (row: Row): string => {
      return rowFields.map((f) => String(row[f] ?? '')).join('\0');
    };

    // 고유한 피봇 키 값 수집 (컬럼이 될 값들)
    const uniquePivotKeys = new Set<string>();
    for (const row of data) {
      uniquePivotKeys.add(getPivotKey(row));
    }
    const sortedPivotKeys = Array.from(uniquePivotKeys).sort();

    // 동적 생성될 컬럼 키 목록
    const generatedValueColumnKeys: string[] = [];
    for (const pivotKey of sortedPivotKeys) {
      for (const vf of valueFields) {
        generatedValueColumnKeys.push(`${pivotKey}_${vf.field}`);
      }
    }

    // 그룹별 데이터 수집
    const groupMap = new Map<string, {
      rowData: Record<string, unknown>;
      values: Map<string, { sum: number; count: number; min: number; max: number; first: unknown; last: unknown }>;
    }>();

    for (const row of data) {
      const rowKey = getRowKey(row);
      const pivotKey = getPivotKey(row);

      // 그룹 초기화
      if (!groupMap.has(rowKey)) {
        const rowData: Record<string, unknown> = {};
        for (const field of rowFields) {
          rowData[field] = row[field];
        }
        groupMap.set(rowKey, { rowData, values: new Map() });
      }

      const group = groupMap.get(rowKey)!;

      // 각 값 필드에 대해 집계 데이터 수집
      for (const vf of valueFields) {
        const fullKey = `${pivotKey}_${vf.field}`;
        const value = row[vf.field];

        if (!group.values.has(fullKey)) {
          group.values.set(fullKey, {
            sum: 0,
            count: 0,
            min: Infinity,
            max: -Infinity,
            first: undefined,
            last: undefined,
          });
        }

        const agg = group.values.get(fullKey)!;
        const numValue = typeof value === 'number' ? value : 0;

        agg.sum += numValue;
        agg.count += 1;
        agg.min = Math.min(agg.min, numValue);
        agg.max = Math.max(agg.max, numValue);
        if (agg.first === undefined) agg.first = value;
        agg.last = value;
      }
    }

    // 피봇된 행 생성
    const rows: Row[] = [];
    for (const [, group] of groupMap) {
      const pivotedRow = { ...group.rowData } as Row;

      // 모든 동적 컬럼에 대해 값 설정
      for (const colKey of generatedValueColumnKeys) {
        const agg = group.values.get(colKey);

        if (agg && agg.count > 0) {
          // 컬럼 키에서 값 필드 추출
          const parts = colKey.split('_');
          const fieldName = parts[parts.length - 1];
          const vf = valueFields.find((v) => v.field === fieldName);

          switch (vf?.aggregate) {
            case 'sum':
              pivotedRow[colKey] = agg.sum;
              break;
            case 'avg':
              pivotedRow[colKey] = agg.sum / agg.count;
              break;
            case 'min':
              pivotedRow[colKey] = agg.min === Infinity ? null : agg.min;
              break;
            case 'max':
              pivotedRow[colKey] = agg.max === -Infinity ? null : agg.max;
              break;
            case 'count':
              pivotedRow[colKey] = agg.count;
              break;
            case 'first':
              pivotedRow[colKey] = agg.first as CellValue;
              break;
            case 'last':
              pivotedRow[colKey] = agg.last as CellValue;
              break;
            default:
              pivotedRow[colKey] = agg.sum;
          }
        } else {
          pivotedRow[colKey] = null;
        }
      }

      rows.push(pivotedRow);
    }

    // 컬럼 정의 생성
    const columns = this.generatePivotColumnDefs(
      rowFields,
      generatedValueColumnKeys,
      valueFields
    );

    return {
      rows,
      columns,
      generatedValueColumnKeys,
    };
  }

  /**
   * 피봇 컬럼 정의 생성
   */
  private generatePivotColumnDefs(
    rowFields: string[],
    generatedKeys: string[],
    _valueFields: { field: string; label?: string }[]
  ): ColumnDef[] {
    // 행 필드 컬럼
    const rowColumnDefs: ColumnDef[] = rowFields.map((field) => ({
      key: field,
      label: field,
      type: 'string' as const,
      width: 120,
    }));

    // 동적 생성된 값 컬럼
    const valueColumnDefs: ColumnDef[] = generatedKeys.map((key) => ({
      key,
      label: this.formatPivotColumnLabel(key),
      type: 'number' as const,
      width: 100,
    }));

    return [...rowColumnDefs, ...valueColumnDefs];
  }

  /**
   * 피봇 컬럼 레이블 포맷팅
   */
  private formatPivotColumnLabel(key: string): string {
    // 예: "2023_Q1_sales" → "2023 Q1 Sales"
    return key
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  // ==========================================================================
  // 유틸리티
  // ==========================================================================

  /**
   * 테이블에서 원본 인덱스 배열 추출
   */
  private extractIndices(table: Table): ProcessorResult {
    // __rowIndex__ 컬럼에서 인덱스 추출
    const indices = table.array('__rowIndex__') as number[];

    return {
      indices: new Uint32Array(indices),
      totalCount: this.rowCount,
      filteredCount: indices.length,
    };
  }
}
