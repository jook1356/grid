/**
 * MaterializeTransformer - 구체화 변환기
 *
 * 파이프라인의 마지막 단계로, 중간 결과(인덱스, 그룹 정보, 피봇 결과)를
 * 렌더링 가능한 Row[] 형태로 변환합니다.
 *
 * "Materialize"란?
 * - 데이터베이스 용어로, 추상적인 뷰나 쿼리 결과를 실제 데이터로 "구체화"하는 것
 * - 파이프라인에서는 인덱스 배열을 실제 Row 객체로 변환하는 과정
 *
 * 왜 마지막에 Row를 만들까?
 * - 효율성: 중간 단계에서 매번 Row를 만들면 메모리 낭비
 * - 인덱스만 전달하다가 마지막에 한 번만 Row 생성
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

import type { Row as RowData } from '../../types';
import { Row } from '../../ui/row/Row';
import type {
  Transformer,
  TransformContext,
  GroupNode,
} from './Transformer';
import { PipelinePhase, cloneContext } from './Transformer';

// =============================================================================
// MaterializeTransformer 설정
// =============================================================================

/**
 * 구체화 옵션
 */
export interface MaterializeOptions {
  /** 그룹 헤더 포함 여부 */
  includeGroupHeaders?: boolean;

  /** 접힌 그룹의 데이터 제외 여부 */
  respectCollapsed?: boolean;

  /** 소계 행 포함 여부 */
  includeSubtotals?: boolean;
}

/**
 * 구체화된 행 정보
 */
export interface MaterializedRow {
  /** Row 인스턴스 */
  row: Row;

  /** 원본 데이터 인덱스 (데이터 행만) */
  dataIndex?: number;

  /** 그룹 경로 (그룹화된 경우) */
  groupPath?: string[];

  /** 그룹 레벨 */
  level?: number;
}

// =============================================================================
// MaterializeTransformer 클래스
// =============================================================================

/**
 * 구체화 변환기
 *
 * 파이프라인의 최종 단계로, 메인 스레드에서 실행됩니다.
 * Row 객체를 생성하여 BodyRenderer가 바로 사용할 수 있게 합니다.
 */
export class MaterializeTransformer implements Transformer {
  readonly name = 'MaterializeTransformer';
  readonly phase = PipelinePhase.MATERIALIZE;
  readonly runInWorker = false; // 메인 스레드에서 실행 (DOM 관련)

  /** 구체화 옵션 */
  private options: MaterializeOptions;

  // ==========================================================================
  // 생성자
  // ==========================================================================

  constructor(options: MaterializeOptions = {}) {
    this.options = {
      includeGroupHeaders: true,
      respectCollapsed: true,
      includeSubtotals: false,
      ...options,
    };
  }

  // ==========================================================================
  // Transformer 구현
  // ==========================================================================

  /**
   * 구체화 변환 실행
   *
   * 컨텍스트의 상태에 따라 적절한 방식으로 Row[]를 생성합니다:
   * 1. 피봇 결과가 있으면 → 피봇 결과를 Row로 변환
   * 2. 그룹 정보가 있으면 → 그룹 헤더 + 데이터 행 생성
   * 3. 인덱스만 있으면 → 인덱스로 데이터 참조하여 Row 생성
   *
   * @param ctx - 입력 컨텍스트
   * @returns materializedRows가 포함된 컨텍스트
   */
  transform(ctx: TransformContext): TransformContext {
    const result = cloneContext(ctx);
    let materializedRows: MaterializedRow[] = [];

    // 1. 피봇 결과가 있는 경우
    if (ctx.pivotResult) {
      materializedRows = this.materializePivotResult(ctx.pivotResult.rows);
    }
    // 2. 그룹 정보가 있는 경우
    else if (ctx.groupInfo) {
      materializedRows = this.materializeGroupedData(
        ctx.data,
        ctx.groupInfo.groups
      );
    }
    // 3. 인덱스만 있는 경우
    else if (ctx.indices) {
      materializedRows = this.materializeIndices(ctx.data, ctx.indices);
    }
    // 4. 아무것도 없으면 전체 데이터
    else {
      materializedRows = this.materializeAllData(ctx.data);
    }

    // 메타데이터에 저장
    result.metadata = {
      ...result.metadata,
      materializedRows,
    };

    return result;
  }

  // ==========================================================================
  // 피봇 결과 구체화
  // ==========================================================================

  /**
   * 피봇 결과를 Row[]로 변환
   */
  private materializePivotResult(pivotedRows: RowData[]): MaterializedRow[] {
    return pivotedRows.map((rowData, index) => ({
      row: new Row({
        variant: 'data',
        structural: false,
        data: rowData as Record<string, unknown>,
      }),
      dataIndex: index,
    }));
  }

  // ==========================================================================
  // 그룹화된 데이터 구체화
  // ==========================================================================

  /**
   * 그룹화된 데이터를 Row[]로 변환
   *
   * 그룹 헤더와 데이터 행을 섞어서 flat list로 만듭니다.
   */
  private materializeGroupedData(
    data: RowData[],
    groups: GroupNode[]
  ): MaterializedRow[] {
    const rows: MaterializedRow[] = [];
    this.flattenGroups(data, groups, rows, []);
    return rows;
  }

  /**
   * 그룹 트리를 flat list로 변환 (재귀)
   */
  private flattenGroups(
    data: RowData[],
    groups: GroupNode[],
    rows: MaterializedRow[],
    parentPath: string[]
  ): void {
    for (const group of groups) {
      const groupPath = [...parentPath, String(group.value)];

      // 그룹 헤더 추가
      if (this.options.includeGroupHeaders) {
        rows.push({
          row: new Row({
            variant: 'group-header',
            structural: true,
            group: {
              id: group.id,
              level: group.level,
              path: groupPath,
              value: group.value as string | number | boolean | Date | null,
              column: '', // GroupNode에서는 column 정보가 없음
              collapsed: group.collapsed,
              itemCount: group.dataIndices.length,
              aggregates: group.aggregates as Record<string, string | number | boolean | Date | null> | undefined,
            },
          }),
          groupPath,
          level: group.level,
        });
      }

      // 접힌 그룹이면 데이터 행 생략
      if (this.options.respectCollapsed && group.collapsed) {
        continue;
      }

      // 자식 그룹이 있으면 재귀
      if (group.children.length > 0) {
        this.flattenGroups(data, group.children, rows, groupPath);
      } else {
        // 리프 노드: 데이터 행 추가
        for (const dataIndex of group.dataIndices) {
          const rowData = data[dataIndex];
          if (rowData) {
            rows.push({
              row: new Row({
                variant: 'data',
                structural: false,
                data: rowData as Record<string, unknown>,
              }),
              dataIndex,
              groupPath,
              level: group.level + 1,
            });
          }
        }
      }

      // 소계 행 추가 (옵션)
      if (this.options.includeSubtotals && group.aggregates) {
        rows.push({
          row: new Row({
            variant: 'subtotal',
            structural: true,
            data: group.aggregates as Record<string, unknown>,
            group: {
              id: `${group.id}_subtotal`,
              level: group.level,
              path: groupPath,
              value: `${group.value} 소계`,
              column: '',
              collapsed: false,
              itemCount: group.dataIndices.length,
            },
          }),
          groupPath,
          level: group.level,
        });
      }
    }
  }

  // ==========================================================================
  // 인덱스 기반 구체화
  // ==========================================================================

  /**
   * 인덱스 배열을 Row[]로 변환
   */
  private materializeIndices(
    data: RowData[],
    indices: Uint32Array
  ): MaterializedRow[] {
    const rows: MaterializedRow[] = [];

    for (let i = 0; i < indices.length; i++) {
      const dataIndex = indices[i]!;
      const rowData = data[dataIndex];

      if (rowData) {
        rows.push({
          row: new Row({
            variant: 'data',
            structural: false,
            data: rowData as Record<string, unknown>,
          }),
          dataIndex,
        });
      }
    }

    return rows;
  }

  // ==========================================================================
  // 전체 데이터 구체화
  // ==========================================================================

  /**
   * 전체 데이터를 Row[]로 변환
   */
  private materializeAllData(data: RowData[]): MaterializedRow[] {
    return data.map((rowData, index) => ({
      row: new Row({
        variant: 'data',
        structural: false,
        data: rowData as Record<string, unknown>,
      }),
      dataIndex: index,
    }));
  }

  // ==========================================================================
  // Getter/Setter
  // ==========================================================================

  /**
   * 옵션 반환
   */
  getOptions(): MaterializeOptions {
    return { ...this.options };
  }

  /**
   * 옵션 변경
   */
  setOptions(options: Partial<MaterializeOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

// =============================================================================
// 헬퍼 함수
// =============================================================================

/**
 * 컨텍스트에서 구체화된 Row 배열 추출
 */
export function getMaterializedRows(ctx: TransformContext): MaterializedRow[] {
  return (ctx.metadata?.materializedRows as MaterializedRow[]) ?? [];
}

/**
 * 구체화된 Row에서 Row 인스턴스만 추출
 */
export function extractRows(materializedRows: MaterializedRow[]): Row[] {
  return materializedRows.map((mr) => mr.row);
}
