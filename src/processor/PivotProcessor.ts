/**
 * PivotProcessor - 피벗 연산 전용 프로세서
 *
 * ArqueroProcessor를 확장하여 피벗 연산을 수행합니다.
 * 메인 스레드에서 실행됩니다 (Worker 사용 안함).
 *
 * 주요 기능:
 * 1. 데이터 집계 (Arquero groupBy + rollup)
 * 2. 컬럼 헤더 트리 빌드 + colspan 계산
 * 3. 행 병합 정보 계산 (same-value 기반)
 * 4. 피벗 데이터 구조 변환
 *
 * @example
 * const processor = new PivotProcessor();
 * await processor.initialize(data);
 *
 * const result = await processor.pivot({
 *   rowFields: ['product'],
 *   columnFields: ['month'],
 *   valueFields: [{ field: 'sales', aggregate: 'sum' }],
 * });
 */

import * as aq from 'arquero';
import type { Table } from 'arquero';
import { ArqueroProcessor } from './ArqueroProcessor';
import type { ColumnDef, CellValue, Row, SortState } from '../types';
import type {
  PivotConfig,
  PivotResult,
  PivotHeaderNode,
  PivotRow,
  RowMergeInfo,
  PivotValueField,
} from '../types/pivot.types';
import { createPivotColumnKey } from '../types/pivot.types';

/**
 * 피벗 연산 전용 프로세서
 */
export class PivotProcessor extends ArqueroProcessor {
  // ============================================================================
  // 메인 피벗 연산
  // ============================================================================

  /**
   * 피벗 연산 수행
   *
   * 데이터 처리 순서: 필터 → 정렬 → 피벗
   *
   * @param config - 피벗 설정 (filters, sorts 포함 가능)
   * @returns 피벗 결과 (헤더 트리, 데이터, 컬럼 정의 등)
   */
  async pivot(config: PivotConfig): Promise<PivotResult> {
    const originalTable = this.getTable();
    if (!originalTable) {
      throw new Error('PivotProcessor not initialized. Call initialize() first.');
    }

    // ==========================================================================
    // 전처리: 필터 → 정렬 (공통 파이프라인)
    // ==========================================================================
    let table = originalTable;

    // 1단계: 필터 적용
    if (config.filters && config.filters.length > 0) {
      for (const filter of config.filters) {
        table = this.applyFilter(table, filter);
      }
    }

    // 2단계: 정렬 적용
    if (config.sorts && config.sorts.length > 0) {
      table = this.applySort(table, config.sorts);
    }

    // ==========================================================================
    // 피벗 연산 (필터/정렬된 테이블 사용)
    // ==========================================================================

    // 3단계: 유니크 값 추출 (columnFields별, 정렬 방향 반영)
    const uniqueValues = this.extractUniqueValues(table, config.columnFields, config.sorts);

    // 4단계: 집계 연산
    const aggregatedData = this.aggregateData(table, config);

    // 5단계: 컬럼 헤더 트리 빌드
    const columnHeaderTree = this.buildHeaderTree(uniqueValues, config);

    // 6단계: 피벗 데이터 구조 변환
    const pivotedData = this.transformToPivotStructure(aggregatedData, config, uniqueValues);

    // 7단계: 행 병합 정보 계산
    const rowMergeInfo = this.calculateRowMergeInfo(pivotedData, config.rowFields);

    // 8단계: 컬럼 정의 생성
    const { columns, rowHeaderColumns } = this.generateColumnDefs(columnHeaderTree, config);

    // 9단계: 헤더 레벨 수 계산
    const headerLevelCount = this.calculateHeaderLevelCount(config);

    return {
      columnHeaderTree,
      headerLevelCount,
      rowMergeInfo,
      pivotedData,
      columns,
      rowHeaderColumns,
      meta: {
        totalRows: pivotedData.length,
        totalColumns: columns.length,
        uniqueValues: Object.fromEntries(
          Object.entries(uniqueValues).map(([k, v]) => [k, v.length])
        ),
      },
    };
  }

  // ============================================================================
  // 전처리 헬퍼 (필터/정렬)
  // ============================================================================

  /**
   * 정렬 적용
   *
   * @param table - 대상 테이블
   * @param sorts - 정렬 조건 배열
   * @returns 정렬된 테이블
   */
  private applySort(table: Table, sorts: SortState[]): Table {
    if (sorts.length === 0) {
      return table;
    }

    const orderArgs = sorts.map((sort) =>
      sort.direction === 'desc' ? aq.desc(sort.columnKey) : sort.columnKey
    );

    return table.orderby(...orderArgs);
  }

  // ============================================================================
  // 유니크 값 추출
  // ============================================================================

  /**
   * columnFields별 유니크 값 추출 (정렬 방향 반영)
   * 
   * @param table - 대상 테이블
   * @param columnFields - 컬럼 필드 배열
   * @param sorts - 정렬 조건 배열 (컬럼 헤더 순서 결정에 사용)
   */
  private extractUniqueValues(
    table: Table,
    columnFields: string[],
    sorts?: SortState[]
  ): Record<string, CellValue[]> {
    const result: Record<string, CellValue[]> = {};

    for (const field of columnFields) {
      // Arquero의 distinct()를 사용하여 유니크 값 추출
      const uniqueTable = table.select(field).dedupe();
      const values = uniqueTable.array(field) as CellValue[];

      // 해당 필드에 대한 정렬 조건 찾기
      const sortConfig = sorts?.find(s => s.columnKey === field);
      const direction = sortConfig?.direction ?? 'asc';

      // 정렬 (문자열/숫자 모두 지원, 정렬 방향 반영)
      values.sort((a, b) => {
        if (a === null || a === undefined) return direction === 'asc' ? 1 : -1;
        if (b === null || b === undefined) return direction === 'asc' ? -1 : 1;
        
        let comparison = 0;
        if (typeof a === 'number' && typeof b === 'number') {
          comparison = a - b;
        } else {
          comparison = String(a).localeCompare(String(b));
        }
        
        return direction === 'desc' ? -comparison : comparison;
      });

      result[field] = values;
    }

    return result;
  }

  // ============================================================================
  // 집계 연산
  // ============================================================================

  /**
   * 데이터 집계 (rowFields + columnFields로 그룹화)
   */
  private aggregateData(
    table: Table,
    config: PivotConfig
  ): Record<string, unknown>[] {
    const groupByFields = [...config.rowFields, ...config.columnFields];

    // 집계 스펙 생성
    const rollupSpec: Record<string, unknown> = {};
    for (const valueField of config.valueFields) {
      rollupSpec[valueField.field] = this.getAggregateOp(
        valueField.aggregate,
        valueField.field
      );
    }

    // 그룹화 + 집계
    let aggregated: Table;
    if (groupByFields.length > 0) {
      aggregated = table.groupby(...groupByFields).rollup(rollupSpec);
    } else {
      // 그룹화 없이 전체 집계
      aggregated = table.rollup(rollupSpec);
    }

    return aggregated.objects() as Record<string, unknown>[];
  }

  /**
   * Arquero 집계 연산자 반환
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
        return aq.op.sum(columnKey);
    }
  }

  // ============================================================================
  // 헤더 트리 빌드
  // ============================================================================

  /**
   * 컬럼 헤더 트리 빌드
   *
   * @param uniqueValues - columnFields별 유니크 값
   * @param config - 피벗 설정
   * @returns 루트 노드
   */
  private buildHeaderTree(
    uniqueValues: Record<string, CellValue[]>,
    config: PivotConfig
  ): PivotHeaderNode {
    const { columnFields, valueFields } = config;

    // 루트 노드 생성
    const root: PivotHeaderNode = {
      value: '__root__',
      label: '',
      level: -1,
      colspan: 0,
      children: [],
      isLeaf: false,
      path: [],
    };

    // 재귀적으로 트리 빌드
    this.buildTreeRecursive(root, columnFields, uniqueValues, valueFields, 0, []);

    // colspan 계산 (리프에서 루트로)
    this.calculateColspan(root);

    return root;
  }

  /**
   * 트리 재귀 빌드
   */
  private buildTreeRecursive(
    parent: PivotHeaderNode,
    columnFields: string[],
    uniqueValues: Record<string, CellValue[]>,
    valueFields: PivotValueField[],
    level: number,
    path: string[]
  ): void {
    // columnFields를 모두 처리했으면 valueFields 레벨
    if (level >= columnFields.length) {
      // valueFields가 1개면 리프 레벨 생략
      if (valueFields.length === 1) {
        parent.columnKey = createPivotColumnKey(path, valueFields[0]!.field);
        parent.isLeaf = true;
        return;
      }

      // valueFields가 여러 개면 리프 레벨 추가
      for (const valueField of valueFields) {
        const leafNode: PivotHeaderNode = {
          value: valueField.field,
          label: valueField.header || valueField.field,
          level,
          colspan: 1,
          children: [],
          isLeaf: true,
          columnKey: createPivotColumnKey(path, valueField.field),
          path: [...path, valueField.field],
        };
        parent.children.push(leafNode);
      }
      return;
    }

    // 현재 레벨의 columnField
    const currentField = columnFields[level];
    if (!currentField) return;

    const values = uniqueValues[currentField] || [];

    for (const value of values) {
      const strValue = String(value ?? '');
      const node: PivotHeaderNode = {
        value: strValue,
        label: strValue,
        level,
        colspan: 0, // 나중에 계산
        children: [],
        isLeaf: false,
        path: [...path, strValue],
      };

      parent.children.push(node);

      // 다음 레벨로 재귀
      this.buildTreeRecursive(
        node,
        columnFields,
        uniqueValues,
        valueFields,
        level + 1,
        [...path, strValue]
      );
    }
  }

  /**
   * colspan 계산 (리프에서 루트로)
   */
  private calculateColspan(node: PivotHeaderNode): number {
    if (node.isLeaf || node.children.length === 0) {
      node.colspan = 1;
      return 1;
    }

    let totalColspan = 0;
    for (const child of node.children) {
      totalColspan += this.calculateColspan(child);
    }
    node.colspan = totalColspan;
    return totalColspan;
  }

  /**
   * 헤더 레벨 수 계산
   */
  private calculateHeaderLevelCount(config: PivotConfig): number {
    // columnFields 개수 + (valueFields가 2개 이상이면 1 추가)
    return config.columnFields.length + (config.valueFields.length > 1 ? 1 : 0);
  }

  // ============================================================================
  // 피벗 데이터 변환
  // ============================================================================

  /**
   * 집계 데이터를 피벗 구조로 변환
   */
  private transformToPivotStructure(
    aggregatedData: Record<string, unknown>[],
    config: PivotConfig,
    uniqueValues: Record<string, CellValue[]>
  ): PivotRow[] {
    const { rowFields, columnFields, valueFields } = config;

    // rowFields 조합별로 데이터 그룹화
    const rowGroups = new Map<string, Record<string, CellValue>>();

    for (const row of aggregatedData) {
      // 행 키 생성 (rowFields 값 조합)
      const rowKey = rowFields.map((f) => String(row[f] ?? '')).join('|');

      // 컬럼 키 생성 (columnFields 값 조합)
      const columnPath = columnFields.map((f) => String(row[f] ?? ''));

      // 행 데이터 가져오기 또는 생성
      let pivotRow = rowGroups.get(rowKey);
      if (!pivotRow) {
        pivotRow = {};
        // rowHeaders 복사
        for (const f of rowFields) {
          pivotRow[f] = row[f] as CellValue;
        }
        rowGroups.set(rowKey, pivotRow);
      }

      // 각 valueField의 값을 피벗 컬럼에 할당
      for (const valueField of valueFields) {
        const colKey = createPivotColumnKey(columnPath, valueField.field);
        pivotRow[colKey] = row[valueField.field] as CellValue;
      }
    }

    // Map을 배열로 변환
    const result: PivotRow[] = [];

    for (const [, rowData] of rowGroups) {
      const pivotRow: PivotRow = {
        rowHeaders: {},
        values: {},
        type: 'data',
      };

      // rowHeaders와 values 분리
      for (const [key, value] of Object.entries(rowData)) {
        if (rowFields.includes(key)) {
          pivotRow.rowHeaders[key] = value;
        } else {
          pivotRow.values[key] = value;
        }
      }

      result.push(pivotRow);
    }

    // 정렬 적용
    // config.sorts가 있으면 해당 조건으로, 없으면 rowFields 기준 기본 정렬
    if (config.sorts && config.sorts.length > 0) {
      result.sort((a, b) => {
        for (const sort of config.sorts!) {
          const { columnKey, direction } = sort;
          
          // rowHeaders에서 값 찾기
          let aVal = a.rowHeaders[columnKey];
          let bVal = b.rowHeaders[columnKey];
          
          // rowHeaders에 없으면 values에서 찾기 (집계 값 기준 정렬)
          if (aVal === undefined) {
            // values에서 해당 컬럼키가 포함된 값들의 합계로 비교
            aVal = this.sumValuesForColumn(a.values, columnKey, config.valueFields);
            bVal = this.sumValuesForColumn(b.values, columnKey, config.valueFields);
          }
          
          if (aVal === bVal) continue;
          if (aVal === null || aVal === undefined) return direction === 'asc' ? 1 : -1;
          if (bVal === null || bVal === undefined) return direction === 'asc' ? -1 : 1;
          
          let comparison = 0;
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            comparison = aVal - bVal;
          } else {
            comparison = String(aVal).localeCompare(String(bVal));
          }
          
          return direction === 'desc' ? -comparison : comparison;
        }
        return 0;
      });
    } else {
      // 기본 정렬: rowFields 기준 오름차순
      result.sort((a, b) => {
        for (const field of rowFields) {
          const aVal = a.rowHeaders[field];
          const bVal = b.rowHeaders[field];
          if (aVal === bVal) continue;
          if (aVal === null || aVal === undefined) return 1;
          if (bVal === null || bVal === undefined) return -1;
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            return aVal - bVal;
          }
          return String(aVal).localeCompare(String(bVal));
        }
        return 0;
      });
    }

    return result;
  }

  // ============================================================================
  // 행 병합 정보 계산
  // ============================================================================

  /**
   * 행 병합 정보 계산 (same-value 기반)
   */
  private calculateRowMergeInfo(
    data: PivotRow[],
    rowFields: string[]
  ): Record<string, RowMergeInfo[]> {
    const result: Record<string, RowMergeInfo[]> = {};

    for (const field of rowFields) {
      const merges: RowMergeInfo[] = [];
      let spanStart = 0;
      let currentValue: CellValue = undefined;

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;

        const value = row.rowHeaders[field];

        if (i === 0) {
          currentValue = value;
          spanStart = 0;
        } else if (value !== currentValue) {
          // 이전 병합 구간 저장
          if (i > spanStart) {
            merges.push({
              startIndex: spanStart,
              span: i - spanStart,
            });
          }
          currentValue = value;
          spanStart = i;
        }
      }

      // 마지막 구간 저장
      if (data.length > spanStart) {
        merges.push({
          startIndex: spanStart,
          span: data.length - spanStart,
        });
      }

      result[field] = merges;
    }

    return result;
  }

  // ============================================================================
  // 정렬 헬퍼
  // ============================================================================

  /**
   * 피벗 결과에서 특정 값 필드의 합계 계산 (정렬용)
   * 
   * 예: sales로 정렬 시, 모든 월의 sales 합계를 계산하여 비교
   */
  private sumValuesForColumn(
    values: Record<string, CellValue>,
    columnKey: string,
    valueFields: PivotValueField[]
  ): number {
    let sum = 0;
    
    // 해당 valueField가 존재하는지 확인
    const valueField = valueFields.find(vf => vf.field === columnKey);
    if (!valueField) {
      return 0;
    }
    
    // values 객체에서 해당 valueField를 포함하는 모든 키의 값을 합산
    // 예: '1월_sales', '2월_sales', ... 모두 합산
    for (const [key, value] of Object.entries(values)) {
      if (key.endsWith('_' + columnKey) || key === columnKey) {
        if (typeof value === 'number') {
          sum += value;
        }
      }
    }
    
    return sum;
  }

  // ============================================================================
  // 컬럼 정의 생성
  // ============================================================================

  /**
   * 컬럼 정의 생성
   */
  private generateColumnDefs(
    headerTree: PivotHeaderNode,
    config: PivotConfig
  ): { columns: ColumnDef[]; rowHeaderColumns: ColumnDef[] } {
    // 행 헤더 컬럼 (rowFields 기준)
    const rowHeaderColumns: ColumnDef[] = config.rowFields.map((field) => ({
      key: field,
      header: field, // TODO: FieldDef에서 가져오기
      width: 150,
      pinned: 'left' as const,
      mergeStrategy: 'same-value' as const,
    }));

    // 피벗 데이터 컬럼 (리프 노드 기준)
    const columns: ColumnDef[] = [];
    this.collectLeafColumns(headerTree, columns, config);

    return { columns, rowHeaderColumns };
  }

  /**
   * 리프 노드에서 컬럼 정의 수집
   */
  private collectLeafColumns(
    node: PivotHeaderNode,
    columns: ColumnDef[],
    config: PivotConfig
  ): void {
    if (node.isLeaf && node.columnKey) {
      // 해당 valueField 찾기
      const valueField = config.valueFields.find(
        (vf) =>
          node.columnKey?.endsWith('_' + vf.field) ||
          node.columnKey === vf.field
      );

      columns.push({
        key: node.columnKey,
        header: node.label,
        width: 100,
        type: 'number',
        formatter: valueField?.formatter,
      });
      return;
    }

    for (const child of node.children) {
      this.collectLeafColumns(child, columns, config);
    }
  }

}

