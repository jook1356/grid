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

    // 4단계: 집계 연산 (Multi-pass)
    const { map: aggregationMap, leafRows } = this.aggregateData(table, config);

    // 5단계: 컬럼 헤더 트리 빌드
    const columnHeaderTree = this.buildHeaderTree(uniqueValues, config);

    // 6단계: 피벗 데이터 구조 변환 (Map + Leaf Data 사용)
    const pivotedData = this.transformToPivotStructure(leafRows, aggregationMap, config, uniqueValues);

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
   * 데이터 집계 (Multi-pass Aggregation)
   * 
   * Arquero를 사용하여 모든 필요한 레벨(Leaf, Subtotal, GrandTotal)의 집계를 수행하고
   * 빠른 조회를 위해 Map 형태로 반환합니다.
   * 또한 Leaf Level 데이터는 구조 구성을 위해 별도 반환합니다.
   */
  private aggregateData(
    table: Table,
    config: PivotConfig
  ): { map: Map<string, number>; leafRows: Record<string, unknown>[] } {
    const {
      rowFields,
      columnFields,
      valueFields,
      showRowSubTotals,
      showColumnSubTotals,
      showRowGrandTotals,
      showColumnGrandTotals
    } = config;

    const aggregationMap = new Map<string, number>();
    let leafRows: Record<string, unknown>[] = [];

    // 헬퍼: 키 생성
    const getMapKey = (rowKey: string, colKey: string, valueField: string) =>
      `${rowKey}::${colKey}::${valueField}`;

    // 헬퍼: 집계 수행 및 맵 저장
    const runAggregation = (
      rFields: string[],
      cFields: string[],
      isRowTotal: boolean,
      isColTotal: boolean,
      isLeafPass: boolean
    ) => {
      const groupByFields = [...rFields, ...cFields];

      const rollupSpec: Record<string, unknown> = {};
      for (const vf of valueFields) {
        rollupSpec[vf.field] = this.getAggregateOp(vf.aggregate, vf.field);
      }

      let result: Table;
      if (groupByFields.length > 0) {
        result = table.groupby(...groupByFields).rollup(rollupSpec);
      } else {
        result = table.rollup(rollupSpec);
      }

      // 결과 매핑
      const rows = result.objects() as any[];

      if (isLeafPass) {
        leafRows = rows;
      }

      for (const row of rows) {
        // Row Key
        const rKey = rFields.length > 0
          ? rFields.map(f => String(row[f] ?? '')).join('|')
          : (isRowTotal ? PIVOT_KEY_GRANDTOTAL : '');

        // Col Key
        const cKey = cFields.length > 0
          ? cFields.map(f => String(row[f] ?? '')).join('|')
          : (isColTotal ? PIVOT_KEY_GRANDTOTAL : '');

        for (const vf of valueFields) {
          const val = row[vf.field];
          if (typeof val === 'number') {
            aggregationMap.set(getMapKey(rKey, cKey, vf.field), val);
          }
        }
      }
    };

    // 1. Leaf Levels (Row Leaf x Col Leaf)
    runAggregation(rowFields, columnFields, false, false, true);

    // 2. Row Subtotals (Row Subsets x Col Leaf)
    if (showRowSubTotals) {
      for (let i = 0; i < rowFields.length; i++) {
        const prefix = rowFields.slice(0, i + 1);
        // 마지막 레벨 미만인 경우에만 Subtotal (마지막 레벨은 Leaf와 동일하므로 Leaf Pass에서 처리됨)
        // 하지만 rowSubTotals의 경우 명시적으로 계산해야 할 수도 있음.
        // 여기서는 prefix length < rowFields.length 인 경우만 계산.
        // 만약 rowFields가 1개뿐이라면? 
        if (prefix.length < rowFields.length) {
          runAggregation(prefix, columnFields, false, false, false);
        }
      }
    }

    // 3. Row GrandTotal (Empty Row x Col Leaf)
    if (showRowGrandTotals) {
      runAggregation([], columnFields, true, false, false);
    }

    // 4. Column Subtotals (Row Leaf x Col Subsets)
    if (showColumnSubTotals) {
      for (let i = 0; i < columnFields.length; i++) {
        const prefix = columnFields.slice(0, i + 1);
        if (prefix.length < columnFields.length) {
          runAggregation(rowFields, prefix, false, false, false);
        }
      }
    }

    // 5. Column GrandTotal (Row Leaf x Empty Col)
    if (showColumnGrandTotals) {
      runAggregation(rowFields, [], false, true, false);
    }

    // 6. Cross Subtotals (Row Subtotals x Col Subtotals)
    if (showRowSubTotals && showColumnSubTotals) {
      for (let r = 0; r < rowFields.length - 1; r++) {
        const rPrefix = rowFields.slice(0, r + 1);
        for (let c = 0; c < columnFields.length - 1; c++) {
          const cPrefix = columnFields.slice(0, c + 1);
          runAggregation(rPrefix, cPrefix, false, false, false);
        }
      }
    }

    // 7. Row Subtotal x Col GrandTotal
    if (showRowSubTotals && showColumnGrandTotals) {
      for (let r = 0; r < rowFields.length - 1; r++) {
        const rPrefix = rowFields.slice(0, r + 1);
        runAggregation(rPrefix, [], false, true, false);
      }
    }

    // 8. Row GrandTotal x Col Subtotal
    if (showRowGrandTotals && showColumnSubTotals) {
      for (let c = 0; c < columnFields.length - 1; c++) {
        const cPrefix = columnFields.slice(0, c + 1);
        runAggregation([], cPrefix, true, false, false);
      }
    }

    // 9. Grand Total (Row Empty x Col Empty)
    if (showRowGrandTotals && showColumnGrandTotals) {
      runAggregation([], [], true, true, false);
    }

    return { map: aggregationMap, leafRows };
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
   * 집계 데이터를 피벗 구조로 변환 (Map 조회 방식)
   *
   * leafRows를 사용하여 행 구조(트리)를 구성하고,값은 aggregationMap에서 조회하여 채웁니다.
   */
  private transformToPivotStructure(
    leafRows: Record<string, unknown>[],
    aggregationMap: Map<string, number>,
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

    // 1. Leaf Row Groups 생성
    // 데이터가 있는 행만 생성됨
    const rowGroups = new Map<string, Record<string, CellValue>>();

    for (const row of leafRows) {
      // 행 키 생성
      const rowKey = rowFields.map((f) => String(row[f] ?? '')).join('|');

      // 행 데이터 객체 초기화 (헤더 정보 저장)
      if (!rowGroups.has(rowKey)) {
        const rowHeaderData: Record<string, CellValue> = {};
        for (const f of rowFields) {
          rowHeaderData[f] = row[f] as CellValue;
        }
        rowGroups.set(rowKey, rowHeaderData);
      }
    }

    // 2. PivotRow 리스트 생성 (Leaf Levels)
    const dataRows: PivotRow[] = [];
    const allColumnKeys = this.getAllColumnKeys(config, uniqueValues);

    // 헬퍼: 값 채우기
    const fillValues = (rowHeaders: Record<string, CellValue>, targetValues: Record<string, CellValue>) => {
      // Row Key 재구성
      const rKey = rowFields.map(f => String(rowHeaders[f] ?? '')).join('|');

      // 모든 가능한 컬럼에 대해 값 조회 (Leaf, Subtotal, GrandTotal)
      for (const colDef of allColumnKeys) {
        // Map Key: RowKey::ColKey::Vf
        const mapKey = `${rKey}::${colDef.colKey}::${colDef.valueField}`;
        const val = aggregationMap.get(mapKey);
        if (val !== undefined) {
          targetValues[colDef.fullKey] = val;
        }
      }
    };

    for (const [rowKey, rowHeaders] of rowGroups) {
      const pivotRow: PivotRow = {
        rowHeaders: { ...rowHeaders },
        values: {},
        type: 'data',
      };

      fillValues(rowHeaders, pivotRow.values);
      dataRows.push(pivotRow);
    }

    // 3. 정렬 적용
    // config.sorts가 있으면 해당 조건으로, 없으면 rowFields 기준 기본 정렬
    if (config.sorts && config.sorts.length > 0) {
      dataRows.sort((a, b) => {
        for (const sort of config.sorts!) {
          const { columnKey, direction } = sort;

          // rowHeaders에서 값 찾기
          let aVal = a.rowHeaders[columnKey];
          let bVal = b.rowHeaders[columnKey];

          // rowHeaders에 없으면 values에서 찾기
          if (aVal === undefined) {
            aVal = a.values[columnKey];
            bVal = b.values[columnKey];
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

    // 4. 부분합(Subtotal) 및 총합계(GrandTotal) 행 삽입
    const result: PivotRow[] = [];

    // 소계 필드 결정
    const subtotalFields: string[] = [];
    if (showRowSubTotals && rowFields.length > 0) {
      if (config.rowSubTotalFields && config.rowSubTotalFields.length > 0) {
        for (const field of rowFields) {
          if (config.rowSubTotalFields.includes(field)) {
            subtotalFields.push(field);
          }
        }
      } else {
        // 모든 rowFields (마지막 제외)
        subtotalFields.push(...rowFields.slice(0, -1));
      }
    }

    if (subtotalFields.length > 0) {
      this.insertMultiLevelSubtotals(dataRows, result, config, subtotalFields, aggregationMap, allColumnKeys);
    } else {
      result.push(...dataRows);
    }

    // 총합계 행 추가
    if (showRowGrandTotals) {
      const grandTotalRow = this.createGrandTotalRow(aggregationMap, allColumnKeys, rowFields);
      result.push(grandTotalRow);
    }

    return result;
  }

  /**
   * 헬퍼: 모든 컬럼 키 목록 생성 (Leaf, Subtotal, GrandTotal)
   */
  private getAllColumnKeys(
    config: PivotConfig,
    uniqueValues: Record<string, CellValue[]>
  ): { fullKey: string; colKey: string; valueField: string }[] {
    const { columnFields, valueFields, showColumnSubTotals, columnSubTotalFields, showColumnGrandTotals } = config;
    const keys: { fullKey: string; colKey: string; valueField: string }[] = [];

    const buildKeys = (
      level: number,
      currentPath: string[],
      addSubtotals: boolean
    ) => {
      if (level >= columnFields.length) {
        // Leaf Level (Value Fields)
        for (const vf of valueFields) {
          keys.push({
            fullKey: createPivotColumnKey(currentPath, vf.field),
            colKey: currentPath.map(String).join('|'),
            valueField: vf.field
          });
        }
        return;
      }

      const field = columnFields[level];
      const values = uniqueValues[field] || [];

      for (const val of values) {
        const strVal = String(val ?? '');
        const nextPath = [...currentPath, strVal];

        buildKeys(level + 1, nextPath, addSubtotals);

        const needSubtotal = showColumnSubTotals &&
          (!columnSubTotalFields || columnSubTotalFields.length === 0 || columnSubTotalFields.includes(field));

        if (needSubtotal && level < columnFields.length - 1) {
          const subPath = [...nextPath, PIVOT_KEY_SUBTOTAL];
          for (const vf of valueFields) {
            keys.push({
              fullKey: createPivotColumnKey(subPath, vf.field),
              colKey: nextPath.map(String).join('|'),
              valueField: vf.field
            });
          }
        }
      }
    };

    buildKeys(0, [], true);

    if (showColumnGrandTotals) {
      const grandTotalPath = [PIVOT_KEY_GRANDTOTAL];
      for (const vf of valueFields) {
        keys.push({
          fullKey: createPivotColumnKey(grandTotalPath, vf.field),
          colKey: PIVOT_KEY_GRANDTOTAL,
          valueField: vf.field
        });
      }
    }

    return keys;
  }

  /**
   * 다중 레벨 소계 삽입
   */
  private insertMultiLevelSubtotals(
    dataRows: PivotRow[],
    result: PivotRow[],
    config: PivotConfig,
    subtotalFields: string[],
    aggregationMap: Map<string, number>,
    allColumnKeys: { fullKey: string; colKey: string; valueField: string }[]
  ): void {
    const { rowFields } = config;

    // 이전 행의 값 저장을 위한 객체 (레벨별)
    const prevValues: Record<number, CellValue> = {};
    let initialized = false;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i]!;

      if (!initialized) {
        for (let l = 0; l < rowFields.length; l++) {
          const field = rowFields[l]!;
          prevValues[l] = row.rowHeaders[field];
        }
        initialized = true;
        result.push(row);
        continue;
      }

      // 그룹 변경 감지 (상위 레벨부터)
      let changeLevel = -1;

      for (let l = 0; l < rowFields.length; l++) {
        const field = rowFields[l]!;
        const val = row.rowHeaders[field];
        if (prevValues[l] !== val) {
          changeLevel = l;
          break;
        }
      }

      if (changeLevel !== -1) {
        // 변경된 레벨부터 가장 깊은 레벨까지 역순으로 소계 삽입
        for (let idx = subtotalFields.length - 1; idx >= 0; idx--) {
          const field = subtotalFields[idx]!;
          const levelIndex = rowFields.indexOf(field);

          if (levelIndex >= changeLevel) {
            const groupHeaders: Record<string, CellValue> = {};
            for (let k = 0; k <= levelIndex; k++) {
              const f = rowFields[k]!;
              groupHeaders[f] = prevValues[k];
            }

            const subtotalRow = this.createSubtotalRow(
              groupHeaders,
              rowFields,
              levelIndex,
              aggregationMap,
              allColumnKeys
            );
            result.push(subtotalRow);
          }
        }
      }

      result.push(row);

      for (let l = 0; l < rowFields.length; l++) {
        const field = rowFields[l]!;
        prevValues[l] = row.rowHeaders[field];
      }
    }

    // 마지막 그룹 닫기
    if (initialized) {
      for (let idx = subtotalFields.length - 1; idx >= 0; idx--) {
        const field = subtotalFields[idx]!;
        const levelIndex = rowFields.indexOf(field);

        const groupHeaders: Record<string, CellValue> = {};
        for (let k = 0; k <= levelIndex; k++) {
          const f = rowFields[k]!;
          groupHeaders[f] = prevValues[k];
        }

        const subtotalRow = this.createSubtotalRow(
          groupHeaders,
          rowFields,
          levelIndex,
          aggregationMap,
          allColumnKeys
        );
        result.push(subtotalRow);
      }
    }
  }

  /**
   * 소계 행 생성
   */
  private createSubtotalRow(
    groupHeaders: Record<string, CellValue>,
    rowFields: string[],
    levelIndex: number,
    aggregationMap: Map<string, number>,
    allColumnKeys: { fullKey: string; colKey: string; valueField: string }[]
  ): PivotRow {
    // Row Key 생성 (소계 레벨까지만 포함)
    const activeFields = rowFields.slice(0, levelIndex + 1);
    const rKey = activeFields.map(f => String(groupHeaders[f] ?? '')).join('|');

    // rowHeaders 설정 (소계 라벨 처리)
    const rowHeaders: Record<string, CellValue> = { ...groupHeaders };
    // 현재 그룹 필드 아래 레벨은 '소계'로 표시
    if (levelIndex < rowFields.length - 1) {
      const nextField = rowFields[levelIndex + 1];
      rowHeaders[nextField] = PIVOT_LABEL_SUBTOTAL;
    }
    // 그 외 하위 레벨은 빈값
    for (let i = levelIndex + 2; i < rowFields.length; i++) {
      rowHeaders[rowFields[i]] = '';
    }

    const subtotalRow: PivotRow = {
      rowHeaders,
      values: {},
      type: 'subtotal',
      depth: levelIndex,
    };

    // 값 채우기
    for (const colDef of allColumnKeys) {
      const mapKey = `${rKey}::${colDef.colKey}::${colDef.valueField}`;
      const val = aggregationMap.get(mapKey);
      if (val !== undefined) {
        subtotalRow.values[colDef.fullKey] = val;
      }
    }

    return subtotalRow;
  }

  /**
   * 총합계 행 생성
   */
  private createGrandTotalRow(
    aggregationMap: Map<string, number>,
    allColumnKeys: { fullKey: string; colKey: string; valueField: string }[],
    rowFields: string[]
  ): PivotRow {
    const grandTotalRow: PivotRow = {
      rowHeaders: {},
      values: {},
      type: 'grandtotal',
    };

    // Row Key
    const rKey = PIVOT_KEY_GRANDTOTAL;

    if (rowFields.length > 0) {
      grandTotalRow.rowHeaders[rowFields[0]] = PIVOT_LABEL_GRANDTOTAL;
      for (let i = 1; i < rowFields.length; i++) {
        grandTotalRow.rowHeaders[rowFields[i]] = '';
      }
    }

    for (const colDef of allColumnKeys) {
      const mapKey = `${rKey}::${colDef.colKey}::${colDef.valueField}`;
      const val = aggregationMap.get(mapKey);
      if (val !== undefined) {
        grandTotalRow.values[colDef.fullKey] = val;
      }
    }

    return grandTotalRow;
  }

  /**
   * 행 병합 정보 계산
   */
  private calculateRowMergeInfo(rows: PivotRow[], rowFields: string[]): Record<string, RowMergeInfo[]> {
    const mergeInfo: Record<string, RowMergeInfo[]> = {};
    if (rows.length === 0 || rowFields.length === 0) {
      return mergeInfo;
    }

    for (const field of rowFields) {
      mergeInfo[field] = [];
    }

    const tracking: Record<string, { value: CellValue; startIndex: number }> = {};
    for (const field of rowFields) {
      tracking[field] = {
        value: rows[0]!.rowHeaders[field],
        startIndex: 0,
      };
    }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      let parentChanged = false;

      for (let j = 0; j < rowFields.length; j++) {
        const field = rowFields[j]!;
        const val = row.rowHeaders[field];
        const tracker = tracking[field]!;

        // PivotRow type check
        const isSpecialRow = row.type !== 'data';
        const prevWasSpecial = rows[i - 1]!.type !== 'data';

        if (parentChanged || val !== tracker.value || isSpecialRow || prevWasSpecial) {
          const rowspan = i - tracker.startIndex;
          if (rowspan > 1) {
            if (!mergeInfo[field]) mergeInfo[field] = {};
            mergeInfo[field]![tracker.startIndex] = { rowspan, colspan: 1 };
            for (let k = tracker.startIndex + 1; k < i; k++) {
              mergeInfo[field]![k] = { rowspan: 0, colspan: 0 };
            }
          } else {
            if (!mergeInfo[field]) mergeInfo[field] = {};
            mergeInfo[field]![tracker.startIndex] = { rowspan: 1, colspan: 1 };
          }

          tracker.value = val;
          tracker.startIndex = i;
          parentChanged = true;
        }
      }
    }

    // 마지막 그룹 처리
    for (const field of rowFields) {
      const tracker = tracking[field]!;
      const rowspan = rows.length - tracker.startIndex;
      if (rowspan > 1) {
        if (!mergeInfo[field]) mergeInfo[field] = {};
        mergeInfo[field]![tracker.startIndex] = { rowspan, colspan: 1 };
        for (let k = tracker.startIndex + 1; k < rows.length; k++) {
          mergeInfo[field]![k] = { rowspan: 0, colspan: 0 };
        }
      } else {
        if (!mergeInfo[field]) mergeInfo[field] = {};
        mergeInfo[field]![tracker.startIndex] = { rowspan: 1, colspan: 1 };
      }
    }

    return mergeInfo;
  }

  /**
   * 정렬용 값 집계 (Placeholder)
   * 현재 로직은 `transformToPivotStructure` 내에서 처리되므로 사용되지 않을 수 있음.
   */
  private sumValuesForColumn(
    values: Record<string, CellValue>,
    columnKey: string,
    valueFields: PivotValueField[]
  ): number {
    return 0;
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

