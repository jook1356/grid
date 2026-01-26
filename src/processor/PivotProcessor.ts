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
import type { ColumnDef, CellValue, SortState } from '../types';
import type {
  PivotConfig,
  PivotResult,
  PivotHeaderNode,
  PivotRow,
  RowMergeInfo,
  PivotValueField,
} from '../types/pivot.types';
import {
  createPivotColumnKey,
  PIVOT_KEY_SUBTOTAL,
  PIVOT_KEY_GRANDTOTAL,
  PIVOT_LABEL_SUBTOTAL,
  PIVOT_LABEL_GRANDTOTAL,
} from '../types/pivot.types';

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
    const { columnFields, valueFields, showColumnSubTotals, columnSubTotalFields, showColumnGrandTotals } = config;

    // 열 소계를 표시할 필드 목록 결정
    const subtotalFields: string[] = [];
    if (showColumnSubTotals && columnFields.length > 0) {
      if (columnSubTotalFields && columnSubTotalFields.length > 0) {
        // 지정된 필드 중 columnFields에 포함된 것만 사용 (순서 유지)
        for (const field of columnFields) {
          if (columnSubTotalFields.includes(field)) {
            subtotalFields.push(field);
          }
        }
      } else {
        // 모든 columnFields에서 소계 (마지막 필드 제외)
        subtotalFields.push(...columnFields.slice(0, -1));
      }
    }

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

    // 레벨 수 계산 (컬럼 필드 수 + 값 필드가 2개 이상인 경우 1)
    const maxLevel = columnFields.length + (valueFields.length > 1 ? 1 : 0);

    // 재귀적으로 트리 빌드
    this.buildTreeRecursive(root, columnFields, uniqueValues, valueFields, 0, [], subtotalFields, maxLevel);

    // 열 총합계 추가
    if (showColumnGrandTotals) {
      this.addGrandTotalColumns(root, valueFields, columnFields.length);
    }

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
    path: string[],
    subtotalFields: string[],
    maxLevel: number
  ): void {
    // columnFields를 모두 처리했으면 valueFields 레벨
    if (level >= columnFields.length) {
      // valueFields가 1개면 리프 레벨 생략 (maxLevel에 도달했으므로)
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
    const shouldAddSubtotal = subtotalFields.includes(currentField);

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
        [...path, strValue],
        subtotalFields,
        maxLevel
      );

      // 열 소계 컬럼 추가 (해당 값의 모든 하위 컬럼 합계)
      if (shouldAddSubtotal) {
        // 소계를 현재 노드의 자식으로 추가 (이렇게 해야 상위 헤더가 병합됨)
        this.addSubtotalColumn(node, node, valueFields, level + 1, [...path, strValue], maxLevel);
      }
    }
  }

  /**
   * 열 소계 컬럼 추가
   */
  /**
   * 열 소계 컬럼 추가
   */
  private addSubtotalColumn(
    parent: PivotHeaderNode,
    dataNode: PivotHeaderNode,
    valueFields: PivotValueField[],
    level: number,
    path: string[],
    maxLevel: number
  ): void {
    const subtotalPath = [...path, PIVOT_KEY_SUBTOTAL];

    const subtotalNode: PivotHeaderNode = {
      value: PIVOT_KEY_SUBTOTAL,
      label: PIVOT_LABEL_SUBTOTAL, // 이제 상위 그룹 내부에 있으므로 '소계'로만 표시
      level,
      colspan: 0,
      children: [],
      isLeaf: false,
      path: subtotalPath,
    };

    parent.children.push(subtotalNode);

    // 하위 레벨이 있으면 빈 노드로 채우기 (레이아웃 유지를 위해)
    // 이미 '소계' 텍스트를 붙였으므로 하위 레벨에는 표시 안 함
    this.fillSubtotalChildrenRecursive(subtotalNode, valueFields, level + 1, subtotalPath, maxLevel, false);
  }

  /**
   * 소계 노드의 하위 레벨을 빈 노드로 채우기
   */
  private fillSubtotalChildrenRecursive(
    parent: PivotHeaderNode,
    valueFields: PivotValueField[],
    level: number,
    path: string[],
    maxLevel: number,
    isFirstLevel = false
  ): void {
    // 리프 레벨에 도달했는지 확인
    const isValueFieldLevel = valueFields.length > 1 && level === maxLevel - 1;
    const isSingleValueLeaf = valueFields.length === 1 && level === maxLevel;

    if (isSingleValueLeaf) {
      parent.columnKey = createPivotColumnKey(path, valueFields[0]!.field);
      parent.isLeaf = true;
      // 단일 값 리프인데 첫 레벨인 경우(깊이가 1단계), 여기서 소계를 표시해야 할 수도 있음
      // 하지만 보통 깊이가 1단계면 소계 컬럼 자체가 생성되지 않거나 의미가 다름.
      // 일단 기존 유지.
      return;
    }

    if (isValueFieldLevel) {
      // 값 필드 레벨 (여러 개)
      // 만약 여기가 FirstLevel이라면 '소계'를 어디에 표시?
      // 값 필드 헤더("판매량", "수익")가 우선이므로 소계 텍스트는 상위에서 처리되었어야 함.
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

    // 중간 레벨: 빈 노드 생성 후 재귀
    if (level < maxLevel) {
      const emptyNode: PivotHeaderNode = {
        value: '',
        label: isFirstLevel ? PIVOT_LABEL_SUBTOTAL : '', // 첫 번째 하위 레벨이면 '소계' 표시
        level,
        colspan: 0,
        children: [],
        isLeaf: false,
        path: path,
      };
      parent.children.push(emptyNode);
      this.fillSubtotalChildrenRecursive(emptyNode, valueFields, level + 1, path, maxLevel, false);
    }
  }

  /**
   * 열 총합계 컬럼 추가
   */
  private addGrandTotalColumns(
    root: PivotHeaderNode,
    valueFields: PivotValueField[],
    columnFieldCount: number
  ): void {
    const grandTotalPath = [PIVOT_KEY_GRANDTOTAL];

    const grandTotalNode: PivotHeaderNode = {
      value: PIVOT_KEY_GRANDTOTAL,
      label: PIVOT_LABEL_GRANDTOTAL,
      level: 0,
      colspan: 0,
      children: [],
      isLeaf: false,
      path: grandTotalPath,
    };

    // valueFields 리프 노드 추가
    if (valueFields.length === 1) {
      grandTotalNode.columnKey = createPivotColumnKey(grandTotalPath, valueFields[0]!.field);
      grandTotalNode.isLeaf = true;
    } else {
      for (const valueField of valueFields) {
        const leafNode: PivotHeaderNode = {
          value: valueField.field,
          label: valueField.header || valueField.field,
          level: columnFieldCount,
          colspan: 1,
          children: [],
          isLeaf: true,
          columnKey: createPivotColumnKey(grandTotalPath, valueField.field),
          path: [...grandTotalPath, valueField.field],
        };
        grandTotalNode.children.push(leafNode);
      }
    }

    root.children.push(grandTotalNode);
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
   *
   * showRowSubTotals가 true이면 각 그룹 하단에 소계 행을 삽입합니다.
   * showRowGrandTotals가 true이면 마지막에 총합계 행을 추가합니다.
   */
  private transformToPivotStructure(
    aggregatedData: Record<string, unknown>[],
    config: PivotConfig,
    uniqueValues: Record<string, CellValue[]>
  ): PivotRow[] {
    const {
      rowFields,
      columnFields,
      valueFields,
      showRowSubTotals,
      showRowGrandTotals,
      showColumnSubTotals,
      columnSubTotalFields,
      showColumnGrandTotals,
    } = config;

    // 열 소계를 표시할 필드 목록 결정
    const colSubtotalFields: string[] = [];
    if (showColumnSubTotals && columnFields.length > 0) {
      if (columnSubTotalFields && columnSubTotalFields.length > 0) {
        for (const field of columnFields) {
          if (columnSubTotalFields.includes(field)) {
            colSubtotalFields.push(field);
          }
        }
      } else {
        colSubtotalFields.push(...columnFields.slice(0, -1));
      }
    }

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

    // Map을 배열로 변환하고 열 소계/총합계 계산
    const dataRows: PivotRow[] = [];

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

      // 열 소계 값 계산
      if (colSubtotalFields.length > 0) {
        this.calculateColumnSubtotals(
          pivotRow,
          columnFields,
          colSubtotalFields,
          valueFields,
          uniqueValues
        );
      }

      // 열 총합계 값 계산
      if (showColumnGrandTotals) {
        this.calculateColumnGrandTotal(pivotRow, valueFields);
      }

      dataRows.push(pivotRow);
    }

    // 정렬 적용
    // config.sorts가 있으면 해당 조건으로, 없으면 rowFields 기준 기본 정렬
    if (config.sorts && config.sorts.length > 0) {
      dataRows.sort((a, b) => {
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
      dataRows.sort((a, b) => {
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

    // ========================================================================
    // 부분합(Subtotal) 및 총합계(GrandTotal) 행 생성
    // ========================================================================
    const result: PivotRow[] = [];

    // 소계를 표시할 필드 목록 결정
    // rowSubTotalFields가 지정되면 해당 필드만, 아니면 showRowSubTotals가 true일 때 모든 rowFields
    const subtotalFields: string[] = [];
    if (showRowSubTotals && rowFields.length > 0) {
      if (config.rowSubTotalFields && config.rowSubTotalFields.length > 0) {
        // 지정된 필드 중 rowFields에 포함된 것만 사용 (순서 유지)
        for (const field of rowFields) {
          if (config.rowSubTotalFields.includes(field)) {
            subtotalFields.push(field);
          }
        }
      } else {
        // 모든 rowFields에서 소계 (마지막 필드 제외 - 마지막은 개별 데이터)
        subtotalFields.push(...rowFields.slice(0, -1));
      }
    }

    // DEBUG
    console.log('[transformToPivotStructure] dataRows count:', dataRows.length);
    console.log('[transformToPivotStructure] subtotalFields:', subtotalFields);
    if (dataRows.length > 0) {
      console.log('[transformToPivotStructure] first dataRow:', dataRows[0]);
      console.log('[transformToPivotStructure] first dataRow values keys:', Object.keys(dataRows[0]?.values || {}));
    }

    if (subtotalFields.length > 0) {
      // 다중 레벨 소계 삽입
      this.insertMultiLevelSubtotals(dataRows, result, rowFields, subtotalFields, config.valueFields);
    } else {
      // 소계 없이 데이터만
      result.push(...dataRows);
    }

    // 총합계 행 추가
    if (showRowGrandTotals) {
      const grandTotalRow = this.createGrandTotalRow(dataRows, rowFields, config.valueFields);
      result.push(grandTotalRow);
    }

    // DEBUG: 최종 결과 확인
    console.log('[transformToPivotStructure] final result count:', result.length);
    const subtotalRows = result.filter(r => r.type === 'subtotal');
    const grandtotalRows = result.filter(r => r.type === 'grandtotal');
    console.log('[transformToPivotStructure] subtotal rows:', subtotalRows.length);
    console.log('[transformToPivotStructure] grandtotal rows:', grandtotalRows.length);
    if (subtotalRows.length > 0) {
      console.log('[transformToPivotStructure] first subtotal row:', subtotalRows[0]);
      console.log('[transformToPivotStructure] first subtotal row values:', subtotalRows[0]?.values);
    }

    return result;
  }

  /**
   * 다중 레벨 소계 삽입
   *
   * 각 소계 필드 레벨에서 그룹이 변경될 때 해당 레벨과 하위 레벨의 소계를 삽입합니다.
   *
   * @example
   * rowFields: ['category', 'product', 'region']
   * subtotalFields: ['category', 'product']
   *
   * 결과:
   * - category A, product 1, region X
   * - category A, product 1, region Y
   * - [product 1 소계]
   * - category A, product 2, region X
   * - [product 2 소계]
   * - [category A 소계]
   * - category B, product 3, region X
   * - [product 3 소계]
   * - [category B 소계]
   */
  private insertMultiLevelSubtotals(
    dataRows: PivotRow[],
    result: PivotRow[],
    rowFields: string[],
    subtotalFields: string[],
    valueFields: PivotValueField[]
  ): void {
    // 각 소계 레벨의 현재 그룹 값과 그룹 행들을 추적
    // 레벨 인덱스는 rowFields 내에서의 위치
    const levelIndices = subtotalFields.map((f) => rowFields.indexOf(f));

    // 각 레벨별 현재 그룹 값
    const currentGroupValues: (CellValue | undefined)[] = subtotalFields.map(() => undefined);

    // 각 레벨별 그룹에 속한 행들 (하위 레벨 소계 포함)
    const groupRowsAtLevel: PivotRow[][] = subtotalFields.map(() => []);

    for (const row of dataRows) {
      // 각 레벨에서 그룹 변경 확인 (상위 레벨부터)
      let changedLevel = -1;

      for (let i = 0; i < subtotalFields.length; i++) {
        const field = subtotalFields[i]!;
        const currentValue = row.rowHeaders[field];
        const prevValue = currentGroupValues[i];

        if (prevValue !== undefined && currentValue !== prevValue) {
          changedLevel = i;
          break; // 상위 레벨이 바뀌면 하위 레벨도 당연히 바뀜
        }
      }

      // 그룹이 변경되었으면 해당 레벨부터 하위 레벨까지 소계 삽입
      if (changedLevel >= 0) {
        // 하위 레벨부터 상위 레벨 순으로 소계 삽입
        for (let i = subtotalFields.length - 1; i >= changedLevel; i--) {
          const field = subtotalFields[i]!;
          const groupValue = currentGroupValues[i];
          const groupRows = groupRowsAtLevel[i]!;

          if (groupRows.length > 0) {
            // 그룹 행들을 상위 레벨에 추가 (가장 상위 레벨은 result에)
            if (i === 0) {
              result.push(...groupRows);
            }
            // 하위 레벨의 행들은 이미 상위에 추가되어 있음

            // 소계 행 생성 (데이터 행만 필터링하여 집계)
            const dataOnlyRows = groupRows.filter((r) => r.type === 'data');
            if (dataOnlyRows.length > 0) {
              const subtotalRow = this.createSubtotalRow(
                dataOnlyRows,
                field,
                groupValue,
                rowFields,
                valueFields,
                levelIndices[i]!
              );

              // 소계를 상위 레벨 그룹에 추가
              if (i === 0) {
                result.push(subtotalRow);
              } else {
                groupRowsAtLevel[i - 1]!.push(subtotalRow);
              }
            }

            // 그룹 초기화
            groupRowsAtLevel[i] = [];
          }
        }
      }

      // 현재 행을 가장 하위 소계 레벨의 그룹에 추가
      const lowestLevel = subtotalFields.length - 1;
      groupRowsAtLevel[lowestLevel]!.push(row);

      // 가장 하위가 아닌 레벨들에도 행 추가 (중첩 구조)
      for (let i = lowestLevel - 1; i >= 0; i--) {
        groupRowsAtLevel[i]!.push(row);
      }

      // 현재 그룹 값 업데이트
      for (let i = 0; i < subtotalFields.length; i++) {
        const field = subtotalFields[i]!;
        currentGroupValues[i] = row.rowHeaders[field];
      }
    }

    // 마지막 그룹들 처리
    for (let i = subtotalFields.length - 1; i >= 0; i--) {
      const field = subtotalFields[i]!;
      const groupValue = currentGroupValues[i];
      const groupRows = groupRowsAtLevel[i]!;

      if (groupRows.length > 0) {
        if (i === 0) {
          result.push(...groupRows);
        }

        const dataOnlyRows = groupRows.filter((r) => r.type === 'data');
        if (dataOnlyRows.length > 0) {
          const subtotalRow = this.createSubtotalRow(
            dataOnlyRows,
            field,
            groupValue,
            rowFields,
            valueFields,
            levelIndices[i]!
          );

          if (i === 0) {
            result.push(subtotalRow);
          } else {
            groupRowsAtLevel[i - 1]!.push(subtotalRow);
          }
        }

        groupRowsAtLevel[i] = [];
      }
    }
  }

  /**
   * 열 소계 값 계산
   *
   * 각 소계 필드에 대해 해당 그룹의 값들을 합산합니다.
   *
   * @example
   * columnFields: ['quarter', 'month']
   * colSubtotalFields: ['quarter']
   *
   * Q1의 소계 = Q1_1월_sales + Q1_2월_sales + Q1_3월_sales
   */
  private calculateColumnSubtotals(
    pivotRow: PivotRow,
    columnFields: string[],
    colSubtotalFields: string[],
    valueFields: PivotValueField[],
    uniqueValues: Record<string, CellValue[]>
  ): void {
    // 재귀적으로 각 레벨의 소계 계산
    this.calculateSubtotalRecursive(pivotRow, columnFields, colSubtotalFields, valueFields, uniqueValues, 0, []);
  }

  /**
   * 재귀적으로 열 소계 계산
   */
  private calculateSubtotalRecursive(
    row: PivotRow,
    columnFields: string[],
    subtotalFields: string[],
    valueFields: PivotValueField[],
    uniqueValues: Record<string, CellValue[]>,
    level: number,
    path: string[]
  ): void {
    if (level >= columnFields.length) return;

    const field = columnFields[level]!;
    const values = uniqueValues[field] || [];
    const shouldCalculateSubtotal = subtotalFields.includes(field);

    for (const val of values) {
      const strVal = String(val ?? '');
      const currentPath = [...path, strVal];

      // 하위 레벨 먼저 계산 (Bottom-up)
      this.calculateSubtotalRecursive(
        row,
        columnFields,
        subtotalFields,
        valueFields,
        uniqueValues,
        level + 1,
        currentPath
      );

      // 현재 레벨 소계 계산
      if (shouldCalculateSubtotal) {
        for (const vf of valueFields) {
          // 변경된 키 구조: 상위값/__subtotal__/값필드
          // addSubtotalColumn에서 생성한 키 구조와 일치해야 함:
          // [...path, strVal, '__subtotal__', vf.field]
          const subtotalKey = this.createSubtotalKey(currentPath, vf.field);

          // 하위 값들의 합계 계산
          // 여기서는 단순하게: 현재 경로(currentPath)로 시작하는 모든 데이터 컬럼을 찾아서 합산
          // (성능 최적화 여지 있음)

          // 이 그룹에 속하는 리프 컬럼들의 값 수집
          let collectedValues: number[] = [];

          const searchPrefix = createPivotColumnKey(currentPath, '');
          const suffix = '_' + vf.field;

          for (const [key, value] of Object.entries(row.values)) {
            if (key === subtotalKey) continue;

            // 현재 그룹에 속하는지 확인
            if (key.startsWith(searchPrefix) && key.endsWith(suffix)) {
              // 소계 컬럼 제외 (중복 합산 방지)
              if (key.includes(PIVOT_KEY_SUBTOTAL)) continue;
              // 총합계 제외
              if (key.includes(PIVOT_KEY_GRANDTOTAL)) continue;

              if (typeof value === 'number') {
                collectedValues.push(value);
              }
            }
          }

          if (collectedValues.length > 0) {
            row.values[subtotalKey] = this.aggregateValues(collectedValues, vf.aggregate);
          }
        }
      }
    }
  }

  /**
   * 열 총합계 값 계산
   *
   * 모든 데이터 컬럼의 값을 합산합니다.
   */
  private calculateColumnGrandTotal(
    pivotRow: PivotRow,
    valueFields: PivotValueField[]
  ): void {
    // 각 valueField에 대해 총합계 계산
    for (const valueField of valueFields) {
      let values: number[] = [];

      for (const [key, value] of Object.entries(pivotRow.values)) {
        // __subtotal__이나 __grandtotal__을 포함하지 않는 데이터 컬럼만
        if (!key.includes(PIVOT_KEY_SUBTOTAL) && !key.includes(PIVOT_KEY_GRANDTOTAL)) {
          if (key.endsWith('_' + valueField.field) && typeof value === 'number') {
            values.push(value);
          }
        }
      }

      // 총합계 컬럼 키 생성 및 값 할당
      const grandTotalColKey = this.createGrandTotalKey(valueField.field);
      pivotRow.values[grandTotalColKey] = this.aggregateValues(values, valueField.aggregate);
    }
  }

  /**
   * 값 집계 헬퍼
   */
  private aggregateValues(values: number[], method: string = 'sum'): number {
    if (values.length === 0) return 0;

    switch (method) {
      case 'sum':
        return values.reduce((a, b) => a + b, 0);
      case 'avg':
        return values.reduce((a, b) => a + b, 0) / values.length;
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      case 'count':
        return values.length;
      default: // sum
        return values.reduce((a, b) => a + b, 0);
    }
  }

  /**
   * 소계 행 생성
   */
  private createSubtotalRow(
    groupRows: PivotRow[],
    groupField: string,
    groupValue: CellValue,
    rowFields: string[],
    valueFields: PivotValueField[],
    depth: number = 0
  ): PivotRow {
    // 그룹 내 모든 값 수집 (키별로 배열 저장)
    const collectedValues: Record<string, number[]> = {};

    for (const row of groupRows) {
      for (const [key, value] of Object.entries(row.values)) {
        if (typeof value === 'number') {
          if (!collectedValues[key]) collectedValues[key] = [];
          collectedValues[key]!.push(value);
        }
      }
    }

    // 각 키별로 적절한 집계 함수 적용
    const aggregatedValues: Record<string, CellValue> = {};
    for (const [key, values] of Object.entries(collectedValues)) {
      // 해당 키가 어떤 valueField에 속하는지 찾기
      const valueField = valueFields.find(vf =>
        key.endsWith('_' + vf.field) || key === vf.field ||
        key.endsWith(PIVOT_KEY_SUBTOTAL + '_' + vf.field) || // 소계 컬럼
        key.endsWith(PIVOT_KEY_GRANDTOTAL + '_' + vf.field)  // 총합계 컬럼
      );

      const aggregateFunc = valueField?.aggregate ?? 'sum';
      aggregatedValues[key] = this.aggregateValues(values, aggregateFunc);
    }

    // DEBUG
    // console.log('[createSubtotalRow] groupField:', groupField, 'aggregated:', aggregatedValues);

    // rowHeaders 설정 (그룹 필드는 그룹 값 + '소계', 나머지는 빈 문자열)
    const rowHeaders: Record<string, CellValue> = {};
    const groupFieldIndex = rowFields.indexOf(groupField);

    for (let i = 0; i < rowFields.length; i++) {
      const field = rowFields[i]!;
      if (i < groupFieldIndex) {
        // 상위 레벨 필드: 첫 번째 데이터 행의 값 유지
        rowHeaders[field] = groupRows[0]?.rowHeaders[field] ?? '';
      } else if (i === groupFieldIndex) {
        // 현재 그룹 필드: 값만 표시
        rowHeaders[field] = groupValue;
      } else if (i === groupFieldIndex + 1) {
        // 바로 아래 레벨 필드: '소계' 표시
        rowHeaders[field] = PIVOT_LABEL_SUBTOTAL;
      } else {
        // 나머지 하위 레벨 필드: 빈 문자열
        rowHeaders[field] = '';
      }
    }

    return {
      rowHeaders,
      values: aggregatedValues,
      type: 'subtotal',
      depth,
    };
  }

  /**
   * 총합계 행 생성
   */
  private createGrandTotalRow(
    dataRows: PivotRow[],
    rowFields: string[],
    valueFields: PivotValueField[]
  ): PivotRow {
    // 모든 값 수집
    const collectedValues: Record<string, number[]> = {};

    for (const row of dataRows) {
      // 소계 행은 제외하고 데이터 행만 합산 (중복 방지)
      // dataRows에는 data, subtotal, grandtotal이 섞여있지 않음? 
      // transformToPivotStructure에서 호출 시 dataRows만 넘겨야 함.
      // 하지만 transformToPivotStructure 구현을 보면 subtotal이 삽입되기 전의 dataRows를 넘기는지 확인 필요.
      // dataRows는 순수 데이터 행들임 (transformToPivotStructure 초반에 생성된 것).

      for (const [key, value] of Object.entries(row.values)) {
        if (typeof value === 'number') {
          if (!collectedValues[key]) collectedValues[key] = [];
          collectedValues[key]!.push(value);
        }
      }
    }

    // 집계 적용
    const aggregatedValues: Record<string, CellValue> = {};
    for (const [key, values] of Object.entries(collectedValues)) {
      const valueField = valueFields.find(vf =>
        key.endsWith('_' + vf.field) || key === vf.field ||
        key.endsWith(PIVOT_KEY_SUBTOTAL + '_' + vf.field) ||
        key.endsWith(PIVOT_KEY_GRANDTOTAL + '_' + vf.field)
      );

      const aggregateFunc = valueField?.aggregate ?? 'sum';
      aggregatedValues[key] = this.aggregateValues(values, aggregateFunc);
    }

    // rowHeaders 설정
    const rowHeaders: Record<string, CellValue> = {};
    for (let i = 0; i < rowFields.length; i++) {
      const field = rowFields[i]!;
      rowHeaders[field] = i === 0 ? PIVOT_LABEL_GRANDTOTAL : '';
    }

    return {
      rowHeaders,
      values: aggregatedValues,
      type: 'grandtotal',
    };
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

      // 컬럼 타입 결정 (소계/총합계 여부)
      const isSubtotal = node.columnKey.includes(PIVOT_KEY_SUBTOTAL);
      const isGrandTotal = node.columnKey.includes(PIVOT_KEY_GRANDTOTAL);
      const pivotType: 'data' | 'subtotal' | 'grandtotal' = isGrandTotal
        ? 'grandtotal'
        : isSubtotal
          ? 'subtotal'
          : 'data';

      columns.push({
        key: node.columnKey,
        header: node.label,
        width: 100,
        type: 'number',
        formatter: valueField?.formatter,
        pivotType,
        structural: isSubtotal || isGrandTotal, // 소계/총합계는 structural
      });
      return;
    }

    for (const child of node.children) {
      this.collectLeafColumns(child, columns, config);
    }
  }

  /**
   * 소계 컬럼 키 생성 헬퍼
   */
  private createSubtotalKey(path: string[], valueField: string): string {
    return createPivotColumnKey([...path, PIVOT_KEY_SUBTOTAL], valueField);
  }

  /**
   * 총합계 컬럼 키 생성 헬퍼
   */
  private createGrandTotalKey(valueField: string): string {
    return createPivotColumnKey([PIVOT_KEY_GRANDTOTAL], valueField);
  }
}

