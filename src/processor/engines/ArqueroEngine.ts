/**
 * ArqueroEngine - Arquero 기반 데이터 처리 엔진
 *
 * IEngine 인터페이스를 구현한 Arquero 엔진입니다.
 * 기존 ArqueroProcessor와 PivotProcessor의 로직을 통합했습니다.
 *
 * Arquero란?
 * - Observable에서 만든 JavaScript 데이터 처리 라이브러리
 * - Python pandas, R dplyr과 비슷한 API
 * - 컬럼 지향(Column-oriented) 저장으로 빠른 연산
 *
 * 권장 사용 케이스:
 * - 필터/정렬 위주의 연산
 * - 번들 사이즈에 민감한 경우 (~150KB)
 * - 10만 건 미만의 데이터
 */

import * as aq from 'arquero';
import type { Table } from 'arquero';
import type { IEngine } from './IEngine';
import type { Row, CellValue, ColumnDef } from '../../types/data.types';
import type { SortState, FilterState } from '../../types/state.types';
import type {
  ProcessorResult,
  AggregateQueryOptions,
  AggregateResult,
} from '../../types/processor.types';
import type {
  PivotConfig,
  PivotResult,
  PivotHeaderNode,
  PivotRow,
  RowMergeInfo,
  PivotValueField,
} from '../../types/pivot.types';
import {
  createPivotColumnKey,
  PIVOT_KEY_SUBTOTAL,
  PIVOT_KEY_GRANDTOTAL,
  PIVOT_LABEL_SUBTOTAL,
  PIVOT_LABEL_GRANDTOTAL,
} from '../../types/pivot.types';

/**
 * Arquero 기반 데이터 처리 엔진
 */
export class ArqueroEngine implements IEngine {
  /** Arquero 테이블 (컬럼 지향 데이터 구조) */
  private table: Table | null = null;

  /** 원본 행 수 */
  private rowCount: number = 0;

  /** 컬럼 키 목록 */
  private columnKeys: string[] = [];

  // ==========================================================================
  // 데이터 로드
  // ==========================================================================

  async loadData(data: Row[]): Promise<void> {
    if (data.length === 0) {
      this.table = null;
      this.rowCount = 0;
      this.columnKeys = [];
      return;
    }

    this.rowCount = data.length;

    // 컬럼 키 추출
    const firstRow = data[0];
    if (firstRow) {
      this.columnKeys = Object.keys(firstRow).filter((k) => k !== '__rowIndex__');
    }

    // Row 배열 → Arquero Table 변환
    this.table = aq.from(data);

    // 원본 인덱스 컬럼 추가 (정렬/필터 후에도 원본 위치 추적용)
    this.table = this.table.derive({
      __rowIndex__: () => (aq.op.row_number() as number) - 1,
    });
  }

  // ==========================================================================
  // 기본 연산
  // ==========================================================================

  async filter(filters: FilterState[]): Promise<ProcessorResult> {
    const table = this.ensureInitialized();

    if (filters.length === 0) {
      return this.extractIndices(table);
    }

    let result = table;
    for (const filter of filters) {
      result = this.applyFilter(result, filter);
    }

    return this.extractIndices(result);
  }

  async sort(sorts: SortState[]): Promise<ProcessorResult> {
    const table = this.ensureInitialized();

    if (sorts.length === 0) {
      return this.extractIndices(table);
    }

    const orderArgs = sorts.map((sort) =>
      sort.direction === 'desc' ? aq.desc(sort.columnKey) : sort.columnKey
    );

    const sorted = table.orderby(...orderArgs);
    return this.extractIndices(sorted);
  }

  async query(options: { filters?: FilterState[]; sorts?: SortState[] }): Promise<ProcessorResult> {
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
      const groupValues: Record<string, CellValue> = {};
      for (const key of options.groupBy) {
        groupValues[key] = row[key] as CellValue;
      }

      const groupKey = options.groupBy.map((key) => String(row[key])).join('|');

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

  // ==========================================================================
  // 피벗
  // ==========================================================================

  async pivot(config: PivotConfig): Promise<PivotResult> {
    const originalTable = this.ensureInitialized();

    // 필드 키 배열 추출
    const columnFieldKeys = config.columnFields.map(f => f.field);
    const rowFieldKeys = config.rowFields.map(f => f.field);

    // 1단계: 필터 적용
    let table = originalTable;
    if (config.filters && config.filters.length > 0) {
      for (const filter of config.filters) {
        table = this.applyFilter(table, filter);
      }
    }

    // 2단계: 정렬 적용
    if (config.sorts && config.sorts.length > 0) {
      table = this.applySort(table, config.sorts);
    }

    // 3단계: 유니크 값 추출
    const uniqueValues = this.extractUniqueValues(table, columnFieldKeys, config.sorts);

    // 4단계: 집계 연산
    const { map: aggregationMap, leafRows } = this.aggregateForPivot(table, config);
    console.log('Worker: aggregationMap size', aggregationMap.size);
    console.log('Worker: aggregationMap sample keys', Array.from(aggregationMap.keys()).slice(0, 5));
    console.log('Worker: uniqueValues keys', Object.keys(uniqueValues));
    console.log('Worker: uniqueValues sample', uniqueValues[columnFieldKeys[0] || '']);

    // 5단계: 컬럼 헤더 트리 빌드
    const columnHeaderTree = this.buildHeaderTree(uniqueValues, config);

    // 6단계: 피벗 데이터 구조 변환
    const pivotedData = this.transformToPivotStructure(
      leafRows,
      aggregationMap,
      config,
      uniqueValues
    );

    // 7단계: 행 병합 정보 계산
    const rowMergeInfo = this.calculateRowMergeInfo(pivotedData, rowFieldKeys);

    // 8단계: 컬럼 정의 생성
    const { columns, rowHeaderColumns } = this.generateColumnDefs(columnHeaderTree, config);

    // 9단계: 헤더 레벨 수 계산
    const headerLevelCount = columnFieldKeys.length + (config.valueFields.length > 1 ? 1 : 0);

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

  // ==========================================================================
  // 데이터 조회
  // ==========================================================================

  async getRows(indices: number[]): Promise<Row[]> {
    const table = this.ensureInitialized();
    const allRows = table.objects() as Row[];

    return indices
      .map((idx) => allRows.find((r) => (r as any).__rowIndex__ === idx))
      .filter((r): r is Row => r !== undefined);
  }

  async getAllRows(): Promise<Row[]> {
    if (!this.table) return [];
    const rows = this.table.objects() as Row[];
    // __rowIndex__ 제거
    return rows.map((row) => {
      const { __rowIndex__, ...rest } = row as any;
      return rest as Row;
    });
  }

  async getUniqueValues(columnKey: string): Promise<CellValue[]> {
    const table = this.ensureInitialized();
    const uniqueTable = table.select(columnKey).dedupe();
    return uniqueTable.array(columnKey) as CellValue[];
  }

  // ==========================================================================
  // 메타데이터
  // ==========================================================================

  getRowCount(): number {
    return this.rowCount;
  }

  getColumnKeys(): string[] {
    return this.columnKeys;
  }

  // ==========================================================================
  // 정리
  // ==========================================================================

  async cleanup(): Promise<void> {
    this.table = null;
    this.rowCount = 0;
    this.columnKeys = [];
  }

  // ==========================================================================
  // 내부 헬퍼
  // ==========================================================================

  /** 초기화 여부 확인 */
  private ensureInitialized(): Table {
    if (!this.table) {
      throw new Error('ArqueroEngine not initialized. Call loadData() first.');
    }
    return this.table;
  }

  /** 테이블에서 원본 인덱스 배열 추출 */
  private extractIndices(table: Table): ProcessorResult {
    const indices = table.array('__rowIndex__') as number[];

    return {
      indices: new Uint32Array(indices),
      totalCount: this.rowCount,
      filteredCount: indices.length,
    };
  }

  /** 단일 필터 적용 */
  private applyFilter(table: Table, filter: FilterState): Table {
    const { columnKey, operator, value, value2 } = filter;

    switch (operator) {
      case 'eq':
        return table.filter(aq.escape((d: Row) => d[columnKey] === value));

      case 'neq':
        return table.filter(aq.escape((d: Row) => d[columnKey] !== value));

      case 'gt':
        return table.filter(
          aq.escape((d: Row) => {
            const v = d[columnKey];
            return v !== null && v !== undefined && v > value!;
          })
        );

      case 'gte':
        return table.filter(
          aq.escape((d: Row) => {
            const v = d[columnKey];
            return v !== null && v !== undefined && v >= value!;
          })
        );

      case 'lt':
        return table.filter(
          aq.escape((d: Row) => {
            const v = d[columnKey];
            return v !== null && v !== undefined && v < value!;
          })
        );

      case 'lte':
        return table.filter(
          aq.escape((d: Row) => {
            const v = d[columnKey];
            return v !== null && v !== undefined && v <= value!;
          })
        );

      case 'contains':
        return table.filter(
          aq.escape((d: Row) => {
            const v = d[columnKey];
            return (
              v !== null &&
              v !== undefined &&
              String(v).toLowerCase().includes(String(value).toLowerCase())
            );
          })
        );

      case 'notContains':
        return table.filter(
          aq.escape((d: Row) => {
            const v = d[columnKey];
            return (
              v === null ||
              v === undefined ||
              !String(v).toLowerCase().includes(String(value).toLowerCase())
            );
          })
        );

      case 'startsWith':
        return table.filter(
          aq.escape((d: Row) => {
            const v = d[columnKey];
            return (
              v !== null &&
              v !== undefined &&
              String(v).toLowerCase().startsWith(String(value).toLowerCase())
            );
          })
        );

      case 'endsWith':
        return table.filter(
          aq.escape((d: Row) => {
            const v = d[columnKey];
            return (
              v !== null &&
              v !== undefined &&
              String(v).toLowerCase().endsWith(String(value).toLowerCase())
            );
          })
        );

      case 'between':
        return table.filter(
          aq.escape((d: Row) => {
            const v = d[columnKey];
            return v !== null && v !== undefined && v >= value! && v <= value2!;
          })
        );

      case 'isNull':
        return table.filter(
          aq.escape((d: Row) => {
            const v = d[columnKey];
            return v === null || v === undefined;
          })
        );

      case 'isNotNull':
        return table.filter(
          aq.escape((d: Row) => {
            const v = d[columnKey];
            return v !== null && v !== undefined;
          })
        );

      default:
        return table;
    }
  }

  /** 정렬 적용 */
  private applySort(table: Table, sorts: SortState[]): Table {
    if (sorts.length === 0) {
      return table;
    }

    const orderArgs = sorts.map((sort) =>
      sort.direction === 'desc' ? aq.desc(sort.columnKey) : sort.columnKey
    );

    return table.orderby(...orderArgs);
  }

  /** 집계 함수 반환 */
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

  // ==========================================================================
  // 피벗 관련 내부 헬퍼
  // ==========================================================================

  /** columnFields별 유니크 값 추출 (정렬 방향 반영) */
  private extractUniqueValues(
    table: Table,
    columnFields: string[],
    sorts?: SortState[]
  ): Record<string, CellValue[]> {
    const result: Record<string, CellValue[]> = {};

    for (const field of columnFields) {
      const uniqueTable = table.select(field).dedupe();
      const values = uniqueTable.array(field) as CellValue[];

      const sortConfig = sorts?.find((s) => s.columnKey === field);
      const direction = sortConfig?.direction ?? 'asc';

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

  /** 피벗용 데이터 집계 */
  private aggregateForPivot(
    table: Table,
    config: PivotConfig
  ): { map: Map<string, number>; leafRows: Record<string, unknown>[] } {
    const {
      rowFields: rowFieldDefs,
      columnFields: columnFieldDefs,
      valueFields,
      showRowSubTotals,
      showColumnSubTotals,
      showRowGrandTotals,
      showColumnGrandTotals,
    } = config;

    // 객체 배열에서 필드 키 배열 추출
    const rowFields = rowFieldDefs.map(f => f.field);
    const columnFields = columnFieldDefs.map(f => f.field);

    const aggregationMap = new Map<string, number>();
    let leafRows: Record<string, unknown>[] = [];

    const getMapKey = (rowKey: string, colKey: string, valueField: string) =>
      `${rowKey}::${colKey}::${valueField}`;

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

      const rows = result.objects() as any[];

      if (isLeafPass) {
        leafRows = rows;
      }

      for (const row of rows) {
        const rKey =
          rFields.length > 0
            ? rFields.map((f) => String(row[f] ?? '')).join('|')
            : isRowTotal
              ? PIVOT_KEY_GRANDTOTAL
              : '';

        const cKey =
          cFields.length > 0
            ? cFields.map((f) => String(row[f] ?? '')).join('|')
            : isColTotal
              ? PIVOT_KEY_GRANDTOTAL
              : '';

        for (const vf of valueFields) {
          const val = row[vf.field];
          if (typeof val === 'number') {
            aggregationMap.set(getMapKey(rKey, cKey, vf.field), val);
          }
        }
      }
    };

    // 1. Leaf Levels
    runAggregation(rowFields, columnFields, false, false, true);

    // 2. Row Subtotals
    if (showRowSubTotals) {
      for (let i = 0; i < rowFields.length; i++) {
        const prefix = rowFields.slice(0, i + 1);
        if (prefix.length < rowFields.length) {
          runAggregation(prefix, columnFields, false, false, false);
        }
      }
    }

    // 3. Row GrandTotal
    if (showRowGrandTotals) {
      runAggregation([], columnFields, true, false, false);
    }

    // 4. Column Subtotals
    if (showColumnSubTotals) {
      for (let i = 0; i < columnFields.length; i++) {
        const prefix = columnFields.slice(0, i + 1);
        if (prefix.length < columnFields.length) {
          runAggregation(rowFields, prefix, false, false, false);
        }
      }
    }

    // 5. Column GrandTotal
    if (showColumnGrandTotals) {
      runAggregation(rowFields, [], false, true, false);
    }

    // 6. Cross Subtotals
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

    // 9. Grand Total
    if (showRowGrandTotals && showColumnGrandTotals) {
      runAggregation([], [], true, true, false);
    }

    return { map: aggregationMap, leafRows };
  }

  /** 컬럼 헤더 트리 빌드 */
  private buildHeaderTree(
    uniqueValues: Record<string, CellValue[]>,
    config: PivotConfig
  ): PivotHeaderNode {
    const {
      columnFields: columnFieldDefs,
      valueFields,
      showColumnSubTotals,
      columnSubTotalFields,
      showColumnGrandTotals,
    } = config;

    // 객체 배열에서 필드 키 배열 추출
    const columnFields = columnFieldDefs.map(f => f.field);

    const subtotalFields: string[] = [];
    if (showColumnSubTotals && columnFields.length > 0) {
      if (columnSubTotalFields && columnSubTotalFields.length > 0) {
        for (const field of columnFields) {
          if (columnSubTotalFields.includes(field)) {
            subtotalFields.push(field);
          }
        }
      } else {
        subtotalFields.push(...columnFields.slice(0, -1));
      }
    }

    const root: PivotHeaderNode = {
      value: '__root__',
      label: '',
      level: -1,
      colspan: 0,
      children: [],
      isLeaf: false,
      path: [],
    };

    const maxLevel = columnFields.length + (valueFields.length > 1 ? 1 : 0);

    this.buildTreeRecursive(root, columnFields, uniqueValues, valueFields, 0, [], subtotalFields, maxLevel);

    if (showColumnGrandTotals) {
      this.addGrandTotalColumns(root, valueFields, columnFields.length);
    }

    this.calculateColspan(root);

    return root;
  }

  /** 트리 재귀 빌드 */
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
    if (level >= columnFields.length) {
      if (valueFields.length === 1) {
        parent.columnKey = createPivotColumnKey(path, valueFields[0]!.field);
        parent.isLeaf = true;
        return;
      }

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
        colspan: 0,
        children: [],
        isLeaf: false,
        path: [...path, strValue],
      };

      parent.children.push(node);

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

      if (shouldAddSubtotal) {
        this.addSubtotalColumn(node, valueFields, level + 1, [...path, strValue], maxLevel);
      }
    }
  }

  /** 열 소계 컬럼 추가 */
  private addSubtotalColumn(
    parent: PivotHeaderNode,
    valueFields: PivotValueField[],
    level: number,
    path: string[],
    maxLevel: number
  ): void {
    const subtotalPath = [...path, PIVOT_KEY_SUBTOTAL];

    const subtotalNode: PivotHeaderNode = {
      value: PIVOT_KEY_SUBTOTAL,
      label: PIVOT_LABEL_SUBTOTAL,
      level,
      colspan: 0,
      children: [],
      isLeaf: false,
      path: subtotalPath,
    };

    parent.children.push(subtotalNode);
    this.fillSubtotalChildren(subtotalNode, valueFields, level + 1, subtotalPath, maxLevel);
  }

  /** 소계 노드의 하위 레벨을 채우기 */
  private fillSubtotalChildren(
    parent: PivotHeaderNode,
    valueFields: PivotValueField[],
    level: number,
    path: string[],
    maxLevel: number
  ): void {
    const isValueFieldLevel = valueFields.length > 1 && level === maxLevel - 1;
    const isSingleValueLeaf = valueFields.length === 1 && level === maxLevel;

    if (isSingleValueLeaf) {
      parent.columnKey = createPivotColumnKey(path, valueFields[0]!.field);
      parent.isLeaf = true;
      return;
    }

    if (isValueFieldLevel) {
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

    if (level < maxLevel) {
      const emptyNode: PivotHeaderNode = {
        value: '',
        label: '',
        level,
        colspan: 0,
        children: [],
        isLeaf: false,
        path: path,
      };
      parent.children.push(emptyNode);
      this.fillSubtotalChildren(emptyNode, valueFields, level + 1, path, maxLevel);
    }
  }

  /** 열 총합계 컬럼 추가 */
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

  /** colspan 계산 */
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

  /** 피벗 데이터 구조 변환 */
  private transformToPivotStructure(
    leafRows: Record<string, unknown>[],
    aggregationMap: Map<string, number>,
    config: PivotConfig,
    uniqueValues: Record<string, CellValue[]>
  ): PivotRow[] {
    const {
      rowFields: rowFieldDefs,
      showRowSubTotals,
      showRowGrandTotals,
    } = config;

    // 객체 배열에서 필드 키 배열 추출
    const rowFields = rowFieldDefs.map(f => f.field);

    const rowGroups = new Map<string, Record<string, CellValue>>();

    for (const row of leafRows) {
      const rowKey = rowFields.map((f) => String(row[f] ?? '')).join('|');

      if (!rowGroups.has(rowKey)) {
        const rowHeaderData: Record<string, CellValue> = {};
        for (const f of rowFields) {
          rowHeaderData[f] = row[f] as CellValue;
        }
        rowGroups.set(rowKey, rowHeaderData);
      }
    }

    const dataRows: PivotRow[] = [];
    const allColumnKeys = this.getAllColumnKeys(config, uniqueValues);

    const fillValues = (
      rowHeaders: Record<string, CellValue>,
      targetValues: Record<string, CellValue>
    ) => {
      const rKey = rowFields.map((f) => String(rowHeaders[f] ?? '')).join('|');

      for (const colDef of allColumnKeys) {
        const mapKey = `${rKey}::${colDef.colKey}::${colDef.valueField}`;
        const val = aggregationMap.get(mapKey);

        // Debug first few values
        // if (Math.random() < 0.001) {
        //   console.log('Worker: Looking for key:', mapKey, 'Found:', val);
        // }

        if (val !== undefined) {
          targetValues[colDef.fullKey] = val;
        }
      }
    };

    for (const [, rowHeaders] of rowGroups) {
      const pivotRow: PivotRow = {
        rowHeaders: { ...rowHeaders },
        values: {},
        type: 'data',
      };

      fillValues(rowHeaders, pivotRow.values);
      dataRows.push(pivotRow);
    }

    // 정렬
    if (config.sorts && config.sorts.length > 0) {
      dataRows.sort((a, b) => {
        for (const sort of config.sorts!) {
          const { columnKey, direction } = sort;
          let aVal = a.rowHeaders[columnKey];
          let bVal = b.rowHeaders[columnKey];

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

    const result: PivotRow[] = [];

    const subtotalFields: string[] = [];
    if (showRowSubTotals && rowFields.length > 0) {
      if (config.rowSubTotalFields && config.rowSubTotalFields.length > 0) {
        for (const field of rowFields) {
          if (config.rowSubTotalFields.includes(field)) {
            subtotalFields.push(field);
          }
        }
      } else {
        subtotalFields.push(...rowFields.slice(0, -1));
      }
    }

    if (subtotalFields.length > 0) {
      this.insertMultiLevelSubtotals(
        dataRows,
        result,
        config,
        subtotalFields,
        aggregationMap,
        allColumnKeys
      );
    } else {
      result.push(...dataRows);
    }

    if (showRowGrandTotals) {
      const grandTotalRow = this.createGrandTotalRow(aggregationMap, allColumnKeys, rowFields);
      result.push(grandTotalRow);
    }

    console.log('ArqueroEngine: Generated pivot result rows', result.length);
    if (result.length > 0) {
      console.log('ArqueroEngine: First row sample', JSON.stringify(result[0]));
    }

    return result;
  }

  /** 모든 컬럼 키 목록 생성 */
  private getAllColumnKeys(
    config: PivotConfig,
    uniqueValues: Record<string, CellValue[]>
  ): { fullKey: string; colKey: string; valueField: string }[] {
    const {
      columnFields: columnFieldDefs,
      valueFields,
      showColumnSubTotals,
      columnSubTotalFields,
      showColumnGrandTotals,
    } = config;
    const columnFields = columnFieldDefs.map(f => f.field);
    const keys: { fullKey: string; colKey: string; valueField: string }[] = [];

    const buildKeys = (level: number, currentPath: string[]) => {
      if (level >= columnFields.length) {
        for (const vf of valueFields) {
          keys.push({
            fullKey: createPivotColumnKey(currentPath, vf.field),
            colKey: currentPath.map(String).join('|'),
            valueField: vf.field,
          });
        }
        return;
      }

      const colField = columnFields[level];
      if (!colField) return;

      const values = uniqueValues[colField] || [];

      for (const val of values) {
        const strVal = String(val ?? '');
        const nextPath = [...currentPath, strVal];

        buildKeys(level + 1, nextPath);

        const needSubtotal =
          showColumnSubTotals &&
          (!columnSubTotalFields ||
            columnSubTotalFields.length === 0 ||
            columnSubTotalFields.includes(colField));

        if (needSubtotal && level < columnFields.length - 1) {
          const subPath = [...nextPath, PIVOT_KEY_SUBTOTAL];
          for (const vf of valueFields) {
            keys.push({
              fullKey: createPivotColumnKey(subPath, vf.field),
              colKey: nextPath.map(String).join('|'),
              valueField: vf.field,
            });
          }
        }
      }
    };

    buildKeys(0, []);

    if (showColumnGrandTotals) {
      const grandTotalPath = [PIVOT_KEY_GRANDTOTAL];
      for (const vf of valueFields) {
        keys.push({
          fullKey: createPivotColumnKey(grandTotalPath, vf.field),
          colKey: PIVOT_KEY_GRANDTOTAL,
          valueField: vf.field,
        });
      }
    }

    return keys;
  }

  /** 다중 레벨 소계 삽입 */
  private insertMultiLevelSubtotals(
    dataRows: PivotRow[],
    result: PivotRow[],
    config: PivotConfig,
    subtotalFields: string[],
    aggregationMap: Map<string, number>,
    allColumnKeys: { fullKey: string; colKey: string; valueField: string }[]
  ): void {
    const rowFields = config.rowFields.map(f => f.field);
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

  /** 소계 행 생성 */
  private createSubtotalRow(
    groupHeaders: Record<string, CellValue>,
    rowFields: string[],
    levelIndex: number,
    aggregationMap: Map<string, number>,
    allColumnKeys: { fullKey: string; colKey: string; valueField: string }[]
  ): PivotRow {
    const activeFields = rowFields.slice(0, levelIndex + 1);
    const rKey = activeFields.map((f) => String(groupHeaders[f] ?? '')).join('|');

    const rowHeaders: Record<string, CellValue> = { ...groupHeaders };
    if (levelIndex < rowFields.length - 1) {
      const nextField = rowFields[levelIndex + 1];
      if (nextField) {
        rowHeaders[nextField] = PIVOT_LABEL_SUBTOTAL;
      }
    }
    for (let i = levelIndex + 2; i < rowFields.length; i++) {
      const field = rowFields[i];
      if (field) {
        rowHeaders[field] = '';
      }
    }

    const subtotalRow: PivotRow = {
      rowHeaders,
      values: {},
      type: 'subtotal',
      depth: levelIndex,
    };

    for (const colDef of allColumnKeys) {
      const mapKey = `${rKey}::${colDef.colKey}::${colDef.valueField}`;
      const val = aggregationMap.get(mapKey);
      if (val !== undefined) {
        subtotalRow.values[colDef.fullKey] = val;
      }
    }

    return subtotalRow;
  }

  /** 총합계 행 생성 */
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

    const rKey = PIVOT_KEY_GRANDTOTAL;

    if (rowFields.length > 0) {
      grandTotalRow.rowHeaders[rowFields[0]!] = PIVOT_LABEL_GRANDTOTAL;
      for (let i = 1; i < rowFields.length; i++) {
        grandTotalRow.rowHeaders[rowFields[i]!] = '';
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

  /** 행 병합 정보 계산 */
  private calculateRowMergeInfo(
    rows: PivotRow[],
    rowFields: string[]
  ): Record<string, RowMergeInfo[]> {
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

        const isSpecialRow = row.type !== 'data';
        const prevRow = rows[i - 1];
        const prevWasSpecial = prevRow && prevRow.type !== 'data';

        if (parentChanged || val !== tracker.value || isSpecialRow || prevWasSpecial) {
          const span = i - tracker.startIndex;
          if (span > 1) {
            mergeInfo[field]!.push({ startIndex: tracker.startIndex, span });
          }

          tracker.value = val;
          tracker.startIndex = i;
          parentChanged = true;
        }
      }
    }

    for (const field of rowFields) {
      const tracker = tracking[field]!;
      const span = rows.length - tracker.startIndex;
      if (span > 1) {
        mergeInfo[field]!.push({ startIndex: tracker.startIndex, span });
      }
    }

    return mergeInfo;
  }

  /** 컬럼 정의 생성 */
  private generateColumnDefs(
    headerTree: PivotHeaderNode,
    config: PivotConfig
  ): { columns: ColumnDef[]; rowHeaderColumns: ColumnDef[] } {
    const rowHeaderColumns: ColumnDef[] = config.rowFields.map((fieldDef) => ({
      key: fieldDef.field,
      header: fieldDef.header ?? fieldDef.field,
      width: 150,
      pinned: 'left' as const,
      mergeStrategy: 'same-value' as const,
    }));

    const columns: ColumnDef[] = [];
    this.collectLeafColumns(headerTree, columns, config);

    return { columns, rowHeaderColumns };
  }

  /** 리프 노드에서 컬럼 정의 수집 */
  private collectLeafColumns(
    node: PivotHeaderNode,
    columns: ColumnDef[],
    config: PivotConfig
  ): void {
    if (node.isLeaf && node.columnKey) {
      const valueField = config.valueFields.find(
        (vf) => node.columnKey?.endsWith('_' + vf.field) || node.columnKey === vf.field
      );

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
        structural: isSubtotal || isGrandTotal,
        pivotValueField: valueField?.field,
      });
      return;
    }

    for (const child of node.children) {
      this.collectLeafColumns(child, columns, config);
    }
  }
}
