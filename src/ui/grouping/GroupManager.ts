/**
 * GroupManager - 행 그룹화 상태 관리
 *
 * 그룹 설정과 접기/펼치기 상태만 관리합니다.
 * VirtualRow[] 생성은 VirtualRowBuilder가 담당합니다.
 *
 * 책임:
 * - 그룹화 설정 (컬럼, 집계 함수)
 * - 접기/펼치기 상태
 * - 그룹 트리 빌드
 *
 * 관심사 분리:
 * - GroupManager: 그룹 상태 관리
 * - VirtualRowBuilder: VirtualRow[] 배열 생성
 *
 * Row 클래스 통합:
 * - flattenWithRows()로 Row 인스턴스 배열 반환
 * - 그룹 헤더: structural: true, variant: 'group-header'
 * - 데이터 행: structural: false, variant: 'data'
 */

import type { Row as RowData, CellValue } from '../../types';
import type {
  GroupingConfig,
  GroupNode,
  VirtualRow,
  GroupHeaderRow,
  DataRow,
  GroupIdentifier,
  AggregateFn,
  AggregateType,
} from '../../types/grouping.types';
import { Row } from '../row/Row';
import type { VirtualRowInfo } from '../row/types';

/**
 * GroupManager 설정
 */
export interface GroupManagerOptions {
  /** 그룹화 설정 */
  config?: GroupingConfig;
}

/**
 * 행 그룹화 관리자
 */
export class GroupManager {
  // 그룹화 설정
  private groupColumns: string[] = [];
  private aggregates: Record<string, AggregateFn> = {};
  private defaultCollapsed: boolean = false;

  // 접힌 그룹 상태
  private collapsedGroups: Set<string> = new Set();

  // 캐시
  private cachedVirtualRows: VirtualRow[] | null = null;
  private cachedData: RowData[] | null = null;

  // Row 인스턴스 캐시
  private cachedRowInstances: VirtualRowInfo[] | null = null;

  constructor(options: GroupManagerOptions = {}) {
    if (options.config) {
      this.setConfig(options.config);
    }
  }

  // ===========================================================================
  // 공개 API
  // ===========================================================================

  /**
   * 그룹화 설정
   */
  setConfig(config: GroupingConfig): void {
    this.groupColumns = config.columns;
    this.aggregates = config.aggregates ?? {};
    this.defaultCollapsed = config.defaultCollapsed ?? false;
    this.invalidateCache();
  }

  /**
   * 그룹화 컬럼 설정
   */
  setGroupColumns(columns: string[]): void {
    this.groupColumns = columns;
    this.collapsedGroups.clear();
    this.invalidateCache();
  }

  /**
   * 그룹화 컬럼 가져오기
   */
  getGroupColumns(): string[] {
    return [...this.groupColumns];
  }

  /**
   * 그룹화 활성화 여부
   */
  isGroupingEnabled(): boolean {
    return this.groupColumns.length > 0;
  }

  /**
   * 그룹화 여부 (alias for isGroupingEnabled)
   */
  hasGrouping(): boolean {
    return this.isGroupingEnabled();
  }

  /**
   * 집계 함수 설정
   */
  setAggregate(columnKey: string, fn: AggregateFn): void {
    this.aggregates[columnKey] = fn;
    this.invalidateCache();
  }

  /**
   * 집계 설정 반환
   *
   * VirtualRowBuilder에서 사용합니다.
   */
  getAggregates(): Record<string, AggregateFn> {
    return { ...this.aggregates };
  }

  /**
   * 접힌 그룹 Set 반환
   *
   * VirtualRowBuilder에서 사용합니다.
   */
  getCollapsedSet(): Set<string> {
    return new Set(this.collapsedGroups);
  }

  /**
   * 그룹 접기
   */
  collapseGroup(groupId: string): void {
    this.collapsedGroups.add(groupId);
    this.invalidateCache();
  }

  /**
   * 그룹 펼치기
   */
  expandGroup(groupId: string): void {
    this.collapsedGroups.delete(groupId);
    this.invalidateCache();
  }

  /**
   * 그룹 토글
   */
  toggleGroup(groupId: string): void {
    if (this.collapsedGroups.has(groupId)) {
      this.expandGroup(groupId);
    } else {
      this.collapseGroup(groupId);
    }
  }

  /**
   * 그룹이 접혀있는지 확인
   */
  isCollapsed(groupId: string): boolean {
    return this.collapsedGroups.has(groupId);
  }

  /**
   * 모든 그룹 펼치기
   */
  expandAll(): void {
    this.collapsedGroups.clear();
    this.invalidateCache();
  }

  /**
   * 모든 그룹 접기
   */
  collapseAll(data: RowData[]): void {
    // 모든 그룹 ID를 수집하여 접기
    const virtualRows = this.flattenWithGroups(data);
    for (const row of virtualRows) {
      if (row.type === 'group-header') {
        this.collapsedGroups.add(row.groupId);
      }
    }
    this.invalidateCache();
  }

  /**
   * 데이터를 가상화용 플랫 배열로 변환
   *
   * 그룹화가 활성화된 경우 그룹 헤더 행을 포함합니다.
   *
   * @deprecated VirtualRowBuilder를 직접 사용하세요.
   * 이 메서드는 하위 호환성을 위해 유지됩니다.
   *
   * @example
   * ```typescript
   * // 권장: VirtualRowBuilder 사용
   * const builder = new VirtualRowBuilder();
   * const virtualRows = builder.build({
   *   type: groupManager.hasGrouping() ? 'grouped' : 'flat',
   *   data,
   *   groupTree: groupManager.buildTree(data),
   *   collapsedSet: groupManager.getCollapsedSet(),
   *   aggregates: groupManager.getAggregates(),
   *   dataVersion: 1,
   * });
   * ```
   */
  flattenWithGroups(data: RowData[]): VirtualRow[] {
    // 캐시 확인
    if (this.cachedVirtualRows && this.cachedData === data) {
      return this.cachedVirtualRows;
    }

    // 그룹화가 비활성화된 경우 그냥 데이터 행으로 변환
    if (!this.isGroupingEnabled()) {
      const result: VirtualRow[] = data.map((row, index) => ({
        type: 'data' as const,
        dataIndex: index,
        data: row,
        groupPath: [],
      }));
      this.cachedVirtualRows = result;
      this.cachedData = data;
      return result;
    }

    // 그룹화 수행
    const grouped = this.groupData(data);
    const result: VirtualRow[] = [];

    this.traverseGroups(grouped, [], result);

    this.cachedVirtualRows = result;
    this.cachedData = data;
    return result;
  }

  /**
   * 캐시 무효화
   */
  invalidateCache(): void {
    this.cachedVirtualRows = null;
    this.cachedData = null;
    this.cachedRowInstances = null;
  }

  /**
   * 그룹 트리만 빌드 (플래트닝 없이)
   *
   * VirtualRowBuilder와 함께 사용합니다.
   * 플래트닝은 VirtualRowBuilder가 담당합니다.
   *
   * @example
   * ```typescript
   * const tree = groupManager.buildTree(data);
   * const virtualRows = builder.build({
   *   type: 'grouped',
   *   data,
   *   groupTree: tree,
   *   collapsedSet: groupManager.getCollapsedSet(),
   *   aggregates: groupManager.getAggregates(),
   *   dataVersion: 1,
   * });
   * ```
   */
  buildTree(data: RowData[]): GroupNode[] {
    if (!this.isGroupingEnabled()) {
      return [];
    }
    return this.groupData(data);
  }

  /**
   * 데이터를 Row 인스턴스 배열로 변환 (Phase 3: Row 클래스 통합)
   *
   * 그룹 헤더: structural: true, variant: 'group-header'
   * 데이터 행: structural: false, variant: 'data'
   */
  flattenWithRows(data: RowData[]): VirtualRowInfo[] {
    // 캐시 확인
    if (this.cachedRowInstances && this.cachedData === data) {
      return this.cachedRowInstances;
    }

    // 그룹화가 비활성화된 경우 데이터 행으로 변환
    if (!this.isGroupingEnabled()) {
      const result: VirtualRowInfo[] = data.map((rowData, index) => ({
        row: new Row({
          structural: false,
          variant: 'data',
          data: rowData as Record<string, unknown>,
        }),
        structural: false,
        dataIndex: index,
        groupPath: [],
      }));
      this.cachedRowInstances = result;
      this.cachedData = data;
      return result;
    }

    // 그룹화 수행
    const grouped = this.groupData(data);
    const result: VirtualRowInfo[] = [];

    this.traverseGroupsWithRows(grouped, [], result, data);

    this.cachedRowInstances = result;
    this.cachedData = data;
    return result;
  }

  /**
   * 그룹 트리를 순회하며 Row 인스턴스 배열로 변환
   */
  private traverseGroupsWithRows(
    nodes: GroupNode[],
    path: GroupIdentifier[],
    result: VirtualRowInfo[],
    data: RowData[]
  ): void {
    for (const node of nodes) {
      const currentPath: GroupIdentifier[] = [
        ...path,
        { column: node.column, value: node.value },
      ];

      // 그룹 ID 생성 (경로 기반)
      const groupId = this.createGroupId(currentPath);
      const isCollapsed = this.collapsedGroups.has(groupId);

      // 그룹 헤더 Row 생성
      const headerRow = new Row({
        id: groupId,
        structural: true,
        variant: 'group-header',
        group: {
          id: groupId,
          level: path.length,
          path: currentPath.map(p => String(p.value)),
          value: node.value,
          column: node.column,
          collapsed: isCollapsed,
          itemCount: node.count,
          aggregates: node.aggregates,
        },
      });

      result.push({
        row: headerRow,
        structural: true,
        groupPath: currentPath.map(p => String(p.value)),
        level: path.length,
      });

      // 접힌 상태면 하위 항목 스킵
      if (isCollapsed) continue;

      // 하위 그룹 또는 데이터 행 추가
      if (node.children && node.children.length > 0) {
        this.traverseGroupsWithRows(node.children, currentPath, result, data);
      } else if (node.rows && node.dataIndices) {
        for (let i = 0; i < node.rows.length; i++) {
          const dataRow = new Row({
            structural: false,
            variant: 'data',
            data: node.rows[i] as Record<string, unknown>,
          });

          result.push({
            row: dataRow,
            structural: false,
            dataIndex: node.dataIndices[i],
            groupPath: currentPath.map(p => String(p.value)),
            level: path.length,
          });
        }
      }
    }
  }

  // ===========================================================================
  // 내부 메서드 (Private)
  // ===========================================================================

  /**
   * 데이터를 트리 구조로 그룹화
   */
  private groupData(data: RowData[]): GroupNode[] {
    if (this.groupColumns.length === 0) {
      return [];
    }

    return this.groupByColumn(data, 0, []);
  }

  /**
   * 특정 레벨에서 그룹화
   */
  private groupByColumn(
    data: RowData[],
    level: number,
    dataIndices: number[]
  ): GroupNode[] {
    const columnKey = this.groupColumns[level];
    const groups: Map<CellValue, { rows: RowData[]; indices: number[] }> = new Map();

    // 원본 인덱스 유지
    const indexedData =
      dataIndices.length > 0
        ? dataIndices.map((i) => ({ row: data[i], index: i }))
        : data.map((row, i) => ({ row, index: i }));

    // 값별로 그룹화
    for (const { row, index } of indexedData) {
      const value = row[columnKey];
      if (!groups.has(value)) {
        groups.set(value, { rows: [], indices: [] });
      }
      const group = groups.get(value)!;
      group.rows.push(row);
      group.indices.push(index);
    }

    // GroupNode 배열로 변환
    const nodes: GroupNode[] = [];

    for (const [value, { rows, indices }] of groups) {
      const node: GroupNode = {
        column: columnKey,
        value,
        count: rows.length,
        aggregates: this.calculateAggregates(rows),
      };

      // 다음 레벨 그룹이 있으면 재귀
      if (level + 1 < this.groupColumns.length) {
        node.children = this.groupByColumn(data, level + 1, indices);
      } else {
        // 리프 노드: 실제 데이터 포함
        node.rows = rows;
        node.dataIndices = indices;
      }

      nodes.push(node);
    }

    // 값으로 정렬
    nodes.sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return String(a.value).localeCompare(String(b.value));
    });

    return nodes;
  }

  /**
   * 그룹 트리를 순회하며 플랫 배열로 변환
   */
  private traverseGroups(
    nodes: GroupNode[],
    path: GroupIdentifier[],
    result: VirtualRow[]
  ): void {
    for (const node of nodes) {
      const currentPath: GroupIdentifier[] = [
        ...path,
        { column: node.column, value: node.value },
      ];

      // 그룹 ID 생성 (경로 기반)
      const groupId = this.createGroupId(currentPath);
      const isCollapsed = this.collapsedGroups.has(groupId);

      // 그룹 헤더 추가
      const headerRow: GroupHeaderRow = {
        type: 'group-header',
        groupId,
        column: node.column,
        value: node.value,
        level: path.length,
        itemCount: node.count,
        collapsed: isCollapsed,
        aggregates: node.aggregates,
        path: currentPath,
      };
      result.push(headerRow);

      // 접힌 상태면 하위 항목 스킵
      if (isCollapsed) continue;

      // 하위 그룹 또는 데이터 행 추가
      if (node.children && node.children.length > 0) {
        this.traverseGroups(node.children, currentPath, result);
      } else if (node.rows && node.dataIndices) {
        for (let i = 0; i < node.rows.length; i++) {
          const dataRow: DataRow = {
            type: 'data',
            dataIndex: node.dataIndices[i],
            data: node.rows[i],
            groupPath: currentPath,
          };
          result.push(dataRow);
        }
      }
    }
  }

  /**
   * 그룹 ID 생성
   */
  private createGroupId(path: GroupIdentifier[]): string {
    return path.map((g) => `${g.column}:${g.value}`).join('/');
  }

  /**
   * 집계 계산
   */
  private calculateAggregates(rows: RowData[]): Record<string, CellValue> {
    const result: Record<string, CellValue> = {};

    for (const [columnKey, fn] of Object.entries(this.aggregates)) {
      const values = rows
        .map((row) => row[columnKey])
        .filter((v) => v != null);

      if (typeof fn === 'function') {
        // 커스텀 집계 함수
        result[columnKey] = fn(values);
      } else {
        // 내장 집계 함수
        result[columnKey] = this.calculateBuiltInAggregate(
          values as (number | string)[],
          fn as AggregateType
        );
      }
    }

    return result;
  }

  /**
   * 내장 집계 함수 계산
   */
  private calculateBuiltInAggregate(
    values: (number | string)[],
    type: AggregateType
  ): CellValue {
    // 숫자만 필터링
    const numbers = values.filter((v) => typeof v === 'number') as number[];

    switch (type) {
      case 'sum':
        return numbers.reduce((a, b) => a + b, 0);
      case 'avg':
        return numbers.length > 0
          ? numbers.reduce((a, b) => a + b, 0) / numbers.length
          : 0;
      case 'count':
        return values.length;
      case 'min':
        return numbers.length > 0 ? Math.min(...numbers) : null;
      case 'max':
        return numbers.length > 0 ? Math.max(...numbers) : null;
      default:
        return null;
    }
  }
}
