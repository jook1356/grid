/**
 * VirtualRowBuilder - VirtualRow 배열 생성기
 *
 * 다양한 소스(Flat, Grouped, Pivot)로부터 통합된 VirtualRow[] 배열을 생성합니다.
 * Stateless 설계로 CRUD/Undo와 자연스럽게 통합됩니다.
 *
 * 책임:
 * - FlatSource → DataRow[] 변환
 * - GroupedSource → GroupHeaderRow + DataRow 혼합 배열 변환
 * - PivotSource → SubtotalRow, GrandTotalRow 포함 배열 변환 (향후)
 * - 캐시 관리 (dataVersion 기반 무효화)
 */

import type { Row as RowData } from '../../types';
import type {
  VirtualRow,
  DataRow,
  GroupHeaderRow,
  GroupIdentifier,
  GroupNode,
  AggregateFn,
  RowState,
} from '../../types/grouping.types';

// =============================================================================
// 소스 타입 정의
// =============================================================================

/**
 * 기본 소스 인터페이스
 */
interface BaseSource {
  /** DataStore 버전 (캐시 무효화용) */
  dataVersion: number;
}

/**
 * Flat 소스 (그룹화 없음)
 */
export interface FlatSource extends BaseSource {
  type: 'flat';
  data: RowData[];
}

/**
 * Grouped 소스 (그룹화 있음)
 */
export interface GroupedSource extends BaseSource {
  type: 'grouped';
  data: RowData[];
  groupTree: GroupNode[];
  collapsedSet: Set<string>;
  aggregates: Record<string, AggregateFn>;
}

/**
 * Pivot 소스 (향후 확장)
 */
export interface PivotSource extends BaseSource {
  type: 'pivot';
  pivotResult: unknown; // PivotResult 타입은 향후 정의
}

/**
 * 행 소스 타입 (Discriminated Union)
 */
export type RowSource = FlatSource | GroupedSource | PivotSource;

// =============================================================================
// VirtualRowBuilder 클래스
// =============================================================================

/**
 * VirtualRow 배열 생성기
 *
 * GroupManager에서 VirtualRow[] 생성 책임을 분리합니다.
 * 다양한 소스 타입을 통합된 VirtualRow[]로 변환합니다.
 *
 * @example
 * ```typescript
 * const builder = new VirtualRowBuilder();
 *
 * // Flat 모드
 * const flatRows = builder.build({
 *   type: 'flat',
 *   data: myData,
 *   dataVersion: 1,
 * });
 *
 * // Grouped 모드
 * const groupedRows = builder.build({
 *   type: 'grouped',
 *   data: myData,
 *   groupTree: groupManager.buildTree(myData),
 *   collapsedSet: groupManager.getCollapsedSet(),
 *   aggregates: groupManager.getAggregates(),
 *   dataVersion: 1,
 * });
 * ```
 */
export class VirtualRowBuilder {
  // 캐시
  private cache: VirtualRow[] | null = null;
  private cacheKey: string | null = null;

  // ==========================================================================
  // 공개 API
  // ==========================================================================

  /**
   * 소스로부터 VirtualRow[] 생성
   *
   * 캐시 키는 dataVersion + 소스 타입별 상태로 구성됩니다.
   * CRUD 발생 시 dataVersion이 증가하여 자동으로 캐시가 무효화됩니다.
   */
  build(source: RowSource): VirtualRow[] {
    const key = this.computeCacheKey(source);

    // 캐시 히트
    if (this.cache && this.cacheKey === key) {
      return this.cache;
    }

    let result: VirtualRow[];

    switch (source.type) {
      case 'flat':
        result = this.buildFlat(source.data);
        break;
      case 'grouped':
        result = this.buildGrouped(source);
        break;
      case 'pivot':
        result = this.buildPivot(source);
        break;
    }

    // 캐시 저장
    this.cache = result;
    this.cacheKey = key;

    return result;
  }

  /**
   * 캐시 무효화
   */
  invalidate(): void {
    this.cache = null;
    this.cacheKey = null;
  }

  /**
   * 현재 캐시된 VirtualRow[] 반환 (캐시 없으면 null)
   */
  getCached(): VirtualRow[] | null {
    return this.cache;
  }

  // ==========================================================================
  // 캐시 키 계산
  // ==========================================================================

  /**
   * 캐시 키 계산
   *
   * - dataVersion: CRUD 시 증가 → 캐시 무효화
   * - collapsedSet: 그룹 펼치기/접기 시 변경
   * - pivotResult.meta: 피벗 결과 변경 감지
   */
  private computeCacheKey(source: RowSource): string {
    const base = `v${source.dataVersion}`;

    switch (source.type) {
      case 'flat':
        return `${base}:flat:${source.data.length}`;
      case 'grouped':
        // collapsedSet을 정렬하여 일관된 키 생성
        const collapsedList = [...source.collapsedSet].sort().join(',');
        return `${base}:grouped:${source.data.length}:${collapsedList}`;
      case 'pivot':
        // 피벗은 향후 구현
        return `${base}:pivot`;
    }
  }

  // ==========================================================================
  // Flat 소스 변환
  // ==========================================================================

  /**
   * Flat 데이터 → DataRow[] 변환
   */
  private buildFlat(data: RowData[]): VirtualRow[] {
    return data.map((row, index) => this.createDataRow(row, index, []));
  }

  // ==========================================================================
  // Grouped 소스 변환
  // ==========================================================================

  /**
   * Grouped 소스 → VirtualRow[] 변환
   */
  private buildGrouped(source: GroupedSource): VirtualRow[] {
    const result: VirtualRow[] = [];
    this.traverseGroupTree(source.groupTree, [], result, source.collapsedSet);
    return result;
  }

  /**
   * 그룹 트리 순회하며 VirtualRow[] 생성
   */
  private traverseGroupTree(
    nodes: GroupNode[],
    path: GroupIdentifier[],
    result: VirtualRow[],
    collapsedSet: Set<string>
  ): void {
    for (const node of nodes) {
      const currentPath: GroupIdentifier[] = [
        ...path,
        { column: node.column, value: node.value },
      ];

      // 그룹 ID 생성
      const groupId = this.createGroupId(currentPath);
      const isCollapsed = collapsedSet.has(groupId);

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
        // 하위 그룹 재귀
        this.traverseGroupTree(node.children, currentPath, result, collapsedSet);
      } else if (node.rows && node.dataIndices) {
        // 리프 노드: 데이터 행 추가
        for (let i = 0; i < node.rows.length; i++) {
          const rowData = node.rows[i];
          const dataIndex = node.dataIndices[i];
          if (rowData === undefined || dataIndex === undefined) continue;

          const dataRow = this.createDataRow(
            rowData,
            dataIndex,
            currentPath
          );
          result.push(dataRow);
        }
      }
    }
  }

  // ==========================================================================
  // Pivot 소스 변환 (향후 구현)
  // ==========================================================================

  /**
   * Pivot 소스 → VirtualRow[] 변환
   *
   * 향후 피벗 기능 구현 시 완성됩니다.
   */
  private buildPivot(_source: PivotSource): VirtualRow[] {
    // TODO: 피벗 결과를 VirtualRow[]로 변환
    // SubtotalRow, GrandTotalRow 포함
    return [];
  }

  // ==========================================================================
  // 헬퍼 메서드
  // ==========================================================================

  /**
   * DataRow 생성
   */
  private createDataRow(
    data: RowData,
    dataIndex: number,
    groupPath: GroupIdentifier[],
    rowState: RowState = 'pristine',
    originalData?: RowData,
    changedFields?: Set<string>
  ): DataRow {
    // rowId 추출 (id 필드가 있으면 사용)
    const rowId = this.extractRowId(data);

    return {
      type: 'data',
      rowId,
      dataIndex,
      data,
      groupPath,
      rowState,
      originalData,
      changedFields,
    };
  }

  /**
   * Row에서 ID 추출
   */
  private extractRowId(row: RowData): string | number | undefined {
    const id = row['id'];
    if (typeof id === 'string' || typeof id === 'number') {
      return id;
    }
    return undefined;
  }

  /**
   * 그룹 ID 생성 (경로 기반)
   */
  private createGroupId(path: GroupIdentifier[]): string {
    return path.map((g) => `${g.column}:${g.value}`).join('/');
  }
}
