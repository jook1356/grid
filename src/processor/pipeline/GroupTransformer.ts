/**
 * GroupTransformer - 그룹화 변환기
 *
 * 데이터를 지정된 컬럼으로 그룹화하여 계층 구조를 생성합니다.
 * 그룹 헤더와 데이터 행을 포함한 flat list로 변환합니다.
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

import type { Row as RowData, CellValue } from '../../types';
import type {
  Transformer,
  TransformContext,
  GroupTransformerConfig,
  GroupNode,
  AggregateField,
} from './Transformer';
import { PipelinePhase, cloneContext } from './Transformer';

// =============================================================================
// GroupTransformer 클래스
// =============================================================================

/**
 * 그룹화 변환기
 *
 * 지정된 컬럼으로 데이터를 그룹화합니다.
 * 메인 스레드에서 실행됩니다 (UI 상호작용이 필요하므로).
 */
export class GroupTransformer implements Transformer {
  readonly name = 'GroupTransformer';
  readonly phase = PipelinePhase.TRANSFORM;
  readonly runInWorker = false; // 그룹 접기/펼치기 UI 상호작용 필요

  /** 그룹 컬럼 배열 */
  private groupColumns: string[] = [];

  /** 접힌 그룹 ID Set */
  private collapsedGroups: Set<string> = new Set();

  /** 집계 설정 */
  private aggregates: AggregateField[] = [];

  // ==========================================================================
  // 생성자
  // ==========================================================================

  constructor(groupColumns: string[] = [], collapsedGroups: string[] = []) {
    this.groupColumns = groupColumns;
    this.collapsedGroups = new Set(collapsedGroups);
  }

  // ==========================================================================
  // Transformer 구현
  // ==========================================================================

  /**
   * 설정 업데이트
   */
  configure(config: Partial<GroupTransformerConfig>): void {
    if (config.groupColumns !== undefined) {
      this.groupColumns = config.groupColumns;
    }
    if (config.collapsedGroups !== undefined) {
      this.collapsedGroups = new Set(config.collapsedGroups);
    }
    if (config.aggregates !== undefined) {
      this.aggregates = config.aggregates;
    }
  }

  /**
   * 그룹화 변환 실행
   *
   * @param ctx - 입력 컨텍스트
   * @returns 그룹 정보가 포함된 컨텍스트
   */
  transform(ctx: TransformContext): TransformContext {
    // 그룹 컬럼이 없으면 그대로 반환
    if (this.groupColumns.length === 0) {
      return ctx;
    }

    const result = cloneContext(ctx);
    const { data, indices } = ctx;

    // 현재 유효한 인덱스 결정
    const sourceIndices = indices ?? this.createSequentialIndices(data.length);

    // 그룹 트리 생성
    const rootGroups = this.buildGroupTree(data, sourceIndices);

    // 집계 계산 (설정된 경우)
    if (this.aggregates.length > 0) {
      this.calculateAggregates(rootGroups, data);
    }

    // 그룹 정보 저장
    result.groupInfo = {
      groupColumns: this.groupColumns,
      collapsedGroups: this.collapsedGroups,
      groups: rootGroups,
    };

    return result;
  }

  // ==========================================================================
  // 그룹화 로직
  // ==========================================================================

  /**
   * 그룹 트리 생성
   */
  private buildGroupTree(data: RowData[], indices: Uint32Array): GroupNode[] {
    if (this.groupColumns.length === 0) {
      return [];
    }

    // 재귀적으로 그룹 생성
    return this.buildGroupLevel(data, Array.from(indices), 0, []);
  }

  /**
   * 특정 레벨의 그룹 생성 (재귀)
   */
  private buildGroupLevel(
    data: RowData[],
    indices: number[],
    level: number,
    parentPath: unknown[]
  ): GroupNode[] {
    const columnKey = this.groupColumns[level];
    if (!columnKey) {
      return [];
    }

    // 현재 레벨의 그룹 값별로 인덱스 분류
    const groupMap = new Map<unknown, number[]>();

    for (const index of indices) {
      const row = data[index];
      if (!row) continue;

      const value = row[columnKey];
      const key = value ?? '__null__'; // null 값 처리

      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(index);
    }

    // 그룹 노드 생성
    const groups: GroupNode[] = [];

    for (const [key, groupIndices] of groupMap) {
      const value = key === '__null__' ? null : key;
      const path = [...parentPath, value];
      const groupId = this.generateGroupId(path);
      const collapsed = this.collapsedGroups.has(groupId);

      const node: GroupNode = {
        id: groupId,
        value,
        level,
        path,
        children: [],
        dataIndices: [],
        collapsed,
      };

      // 하위 레벨이 있으면 재귀
      if (level < this.groupColumns.length - 1) {
        node.children = this.buildGroupLevel(data, groupIndices, level + 1, path);
        // 리프 인덱스는 자식들에게서 수집
        node.dataIndices = node.children.flatMap(child => child.dataIndices);
      } else {
        // 최하위 레벨: 실제 데이터 인덱스 저장
        node.dataIndices = groupIndices;
      }

      groups.push(node);
    }

    // 그룹 값으로 정렬
    groups.sort((a, b) => this.compareGroupValues(a.value, b.value));

    return groups;
  }

  /**
   * 그룹 ID 생성
   */
  private generateGroupId(path: unknown[]): string {
    return path.map(v => (v === null ? 'null' : String(v))).join('|||');
  }

  /**
   * 그룹 값 비교 (정렬용)
   */
  private compareGroupValues(a: unknown, b: unknown): number {
    // null은 마지막으로
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;

    // 문자열 비교
    return String(a).localeCompare(String(b));
  }

  // ==========================================================================
  // 집계 계산
  // ==========================================================================

  /**
   * 그룹별 집계 계산
   */
  private calculateAggregates(groups: GroupNode[], data: RowData[]): void {
    for (const group of groups) {
      group.aggregates = this.computeGroupAggregates(group, data);

      // 자식 그룹도 재귀적으로 계산
      if (group.children.length > 0) {
        this.calculateAggregates(group.children, data);
      }
    }
  }

  /**
   * 단일 그룹의 집계 계산
   */
  private computeGroupAggregates(
    group: GroupNode,
    data: RowData[]
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const agg of this.aggregates) {
      const values: CellValue[] = [];

      for (const index of group.dataIndices) {
        const row = data[index];
        if (row) {
          values.push(row[agg.columnKey] as CellValue);
        }
      }

      const resultKey = agg.resultKey ?? `${agg.columnKey}_${agg.function}`;
      result[resultKey] = this.applyAggregateFunction(values, agg.function);
    }

    return result;
  }

  /**
   * 집계 함수 적용
   */
  private applyAggregateFunction(
    values: CellValue[],
    func: AggregateField['function']
  ): CellValue {
    const validValues = values.filter(v => v !== null && v !== undefined);
    const numbers = validValues.filter((v): v is number => typeof v === 'number');

    switch (func) {
      case 'sum':
        return numbers.reduce((a, b) => a + b, 0);

      case 'avg':
        return numbers.length > 0 
          ? numbers.reduce((a, b) => a + b, 0) / numbers.length 
          : null;

      case 'min':
        return numbers.length > 0 ? Math.min(...numbers) : null;

      case 'max':
        return numbers.length > 0 ? Math.max(...numbers) : null;

      case 'count':
        return validValues.length;

      case 'first':
        return validValues[0] ?? null;

      case 'last':
        return validValues[validValues.length - 1] ?? null;

      default:
        return null;
    }
  }

  // ==========================================================================
  // 그룹 접기/펼치기
  // ==========================================================================

  /**
   * 그룹 접기/펼치기 토글
   */
  toggleGroup(groupId: string): boolean {
    if (this.collapsedGroups.has(groupId)) {
      this.collapsedGroups.delete(groupId);
      return false;
    } else {
      this.collapsedGroups.add(groupId);
      return true;
    }
  }

  /**
   * 그룹 접힘 상태 확인
   */
  isCollapsed(groupId: string): boolean {
    return this.collapsedGroups.has(groupId);
  }

  /**
   * 모든 그룹 펼치기
   */
  expandAll(): void {
    this.collapsedGroups.clear();
  }

  /**
   * 모든 그룹 접기
   */
  collapseAll(groups: GroupNode[]): void {
    const collectGroupIds = (nodes: GroupNode[]): void => {
      for (const node of nodes) {
        this.collapsedGroups.add(node.id);
        if (node.children.length > 0) {
          collectGroupIds(node.children);
        }
      }
    };

    collectGroupIds(groups);
  }

  // ==========================================================================
  // 유틸리티
  // ==========================================================================

  /**
   * 순차 인덱스 배열 생성
   */
  private createSequentialIndices(length: number): Uint32Array {
    const indices = new Uint32Array(length);
    for (let i = 0; i < length; i++) {
      indices[i] = i;
    }
    return indices;
  }

  /**
   * 그룹 컬럼 반환
   */
  getGroupColumns(): string[] {
    return [...this.groupColumns];
  }

  /**
   * 그룹 컬럼 설정
   */
  setGroupColumns(columns: string[]): void {
    this.groupColumns = columns;
  }

  /**
   * 집계 설정 반환
   */
  getAggregates(): AggregateField[] {
    return [...this.aggregates];
  }

  /**
   * 집계 설정 변경
   */
  setAggregates(aggregates: AggregateField[]): void {
    this.aggregates = aggregates;
  }
}
