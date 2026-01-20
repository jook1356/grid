/**
 * PivotTransformer - 피봇 변환기
 *
 * 데이터를 피봇하여 행↔열 변환을 수행합니다.
 * Arquero의 pivot() 기능을 활용하여 동적 컬럼을 생성합니다.
 *
 * 피봇 개념:
 * - rowFields: 행으로 유지될 필드 (그룹 기준)
 * - columnFields: 열로 펼쳐질 필드 (동적 컬럼 생성)
 * - valueFields: 집계될 값 필드
 *
 * @example
 * 원본:
 * | dept | year | quarter | sales |
 * | A    | 2023 | Q1      | 100   |
 * | A    | 2023 | Q2      | 150   |
 *
 * 피봇 후 (columnFields: ['year', 'quarter']):
 * | dept | 2023_Q1_sales | 2023_Q2_sales |
 * | A    | 100           | 150           |
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

import type { Row as RowData, ColumnDef } from '../../types';
import type {
  Transformer,
  TransformContext,
  PivotTransformerConfig,
  PivotTransformResult,
  ValueFieldConfig,
} from './Transformer';
import { PipelinePhase, cloneContext } from './Transformer';

// =============================================================================
// 피봇 설정 타입
// =============================================================================

/**
 * 피봇 설정
 */
export interface PivotConfig {
  /** 행으로 유지될 필드 */
  rowFields: string[];

  /** 열로 펼쳐질 필드 */
  columnFields: string[];

  /** 값/집계 필드 */
  valueFields: ValueFieldConfig[];
}

/**
 * 피봇 결과
 */
export interface PivotResult {
  /** 피봇된 행 데이터 */
  rows: RowData[];

  /** 생성된 컬럼 정의 */
  columns: ColumnDef[];

  /** 동적 생성된 값 컬럼 키 목록 */
  generatedValueColumnKeys: string[];
}

// =============================================================================
// PivotTransformer 클래스
// =============================================================================

/**
 * 피봇 변환기
 *
 * Worker에서 실행되어 대용량 데이터를 효율적으로 피봇합니다.
 * Arquero의 fold + groupby + pivot을 활용합니다.
 */
export class PivotTransformer implements Transformer {
  readonly name = 'PivotTransformer';
  readonly phase = PipelinePhase.TRANSFORM;
  readonly runInWorker = true;

  /** 피봇 설정 */
  private config: PivotConfig;

  // ==========================================================================
  // 생성자
  // ==========================================================================

  constructor(config: PivotConfig) {
    this.config = config;
  }

  // ==========================================================================
  // Transformer 구현
  // ==========================================================================

  /**
   * 설정 업데이트
   */
  configure(newConfig: Partial<PivotTransformerConfig>): void {
    if (newConfig.rowFields !== undefined) {
      this.config.rowFields = newConfig.rowFields;
    }
    if (newConfig.columnFields !== undefined) {
      this.config.columnFields = newConfig.columnFields;
    }
    if (newConfig.valueFields !== undefined) {
      this.config.valueFields = newConfig.valueFields;
    }
  }

  /**
   * 피봇 변환 실행
   *
   * 실제 피봇 로직은 ArqueroProcessor에서 수행됩니다.
   * 이 메서드는 컨텍스트에 피봇 설정을 기록하고,
   * Worker에서 실행될 때 ArqueroProcessor.pivot()이 호출됩니다.
   *
   * @param ctx - 입력 컨텍스트
   * @returns 피봇 결과가 포함된 컨텍스트
   */
  transform(ctx: TransformContext): TransformContext {
    const result = cloneContext(ctx);

    // 피봇 설정이 없으면 그대로 반환
    if (this.config.columnFields.length === 0) {
      return ctx;
    }

    // 메인 스레드에서 직접 실행될 경우 (테스트용)
    // 실제로는 Worker에서 ArqueroProcessor.pivot()이 호출됨
    if (!ctx.pivotResult) {
      const pivotResult = this.executePivot(ctx.data, ctx.indices);
      result.pivotResult = pivotResult;
      result.columns = pivotResult.columns;
    }

    return result;
  }

  // ==========================================================================
  // 피봇 로직 (메인 스레드용, 테스트/폴백)
  // ==========================================================================

  /**
   * 피봇 실행 (메인 스레드용)
   *
   * Worker 없이 실행할 때 사용됩니다.
   * 대용량 데이터에서는 Worker의 ArqueroProcessor.pivot() 권장.
   */
  private executePivot(
    data: RowData[],
    indices: Uint32Array | null
  ): PivotTransformResult {
    // 유효한 데이터만 추출
    const sourceData = indices
      ? Array.from(indices).map(i => data[i]!).filter(Boolean)
      : data;

    // 그룹화 키 생성
    const groupMap = new Map<string, Map<string, number>>();
    const { rowFields, columnFields, valueFields } = this.config;

    // 동적 컬럼 값 수집
    const columnValueSets = columnFields.map(() => new Set<string>());

    for (const row of sourceData) {
      // 행 키 생성
      const rowKey = rowFields.map(f => String(row[f] ?? '')).join('\0');

      // 컬럼 키 생성 (동적 컬럼 값)
      const colValues = columnFields.map(f => String(row[f] ?? ''));
      colValues.forEach((v, i) => columnValueSets[i]!.add(v));
      const colKey = colValues.join('_');

      // 그룹 데이터 저장
      if (!groupMap.has(rowKey)) {
        groupMap.set(rowKey, new Map());
      }

      const rowGroup = groupMap.get(rowKey)!;

      // 각 값 필드에 대해 집계
      for (const vf of valueFields) {
        const fullKey = `${colKey}_${vf.field}`;
        const value = row[vf.field];

        if (typeof value === 'number') {
          const current = rowGroup.get(fullKey) ?? 0;
          // 기본 집계: sum
          switch (vf.aggregate) {
            case 'sum':
              rowGroup.set(fullKey, current + value);
              break;
            case 'count':
              rowGroup.set(fullKey, current + 1);
              break;
            case 'avg':
              // avg는 sum/count로 나중에 계산
              rowGroup.set(`${fullKey}_sum`, (rowGroup.get(`${fullKey}_sum`) ?? 0) + value);
              rowGroup.set(`${fullKey}_count`, (rowGroup.get(`${fullKey}_count`) ?? 0) + 1);
              break;
            case 'min':
              rowGroup.set(fullKey, Math.min(current === 0 ? Infinity : current, value));
              break;
            case 'max':
              rowGroup.set(fullKey, Math.max(current === 0 ? -Infinity : current, value));
              break;
            default:
              rowGroup.set(fullKey, current + value);
          }
        }
      }
    }

    // 동적 컬럼 키 생성
    const generatedValueColumnKeys = this.generateColumnKeys(columnValueSets, valueFields);

    // 피봇된 행 생성
    const pivotedRows: RowData[] = [];

    for (const [rowKey, rowGroup] of groupMap) {
      const rowValues = rowKey.split('\0');
      const pivotedRow: RowData = {};

      // 행 필드 값 설정
      rowFields.forEach((field, i) => {
        pivotedRow[field] = rowValues[i] ?? null;
      });

      // 동적 컬럼 값 설정
      for (const colKey of generatedValueColumnKeys) {
        // avg 처리
        if (colKey.includes('_avg_')) {
          const sumKey = colKey.replace('_avg_', '_sum_');
          const countKey = colKey.replace('_avg_', '_count_');
          const sum = rowGroup.get(sumKey) ?? 0;
          const count = rowGroup.get(countKey) ?? 1;
          pivotedRow[colKey] = sum / count;
        } else {
          pivotedRow[colKey] = rowGroup.get(colKey) ?? null;
        }
      }

      pivotedRows.push(pivotedRow);
    }

    // 컬럼 정의 생성
    const columns = this.generateColumnDefs(generatedValueColumnKeys);

    return {
      rows: pivotedRows,
      columns,
      sourceIndices: undefined,
    };
  }

  /**
   * 동적 컬럼 키 생성
   */
  private generateColumnKeys(
    columnValueSets: Set<string>[],
    valueFields: ValueFieldConfig[]
  ): string[] {
    const keys: string[] = [];

    // 컬럼 값 조합 생성
    const combinations = this.cartesianProduct(
      columnValueSets.map(s => Array.from(s).sort())
    );

    for (const combo of combinations) {
      const colPrefix = combo.join('_');
      for (const vf of valueFields) {
        keys.push(`${colPrefix}_${vf.field}`);
      }
    }

    return keys;
  }

  /**
   * 카테시안 곱 (조합 생성)
   */
  private cartesianProduct(arrays: string[][]): string[][] {
    if (arrays.length === 0) return [[]];
    if (arrays.length === 1) return arrays[0]!.map(v => [v]);

    const [first, ...rest] = arrays;
    const restProduct = this.cartesianProduct(rest);

    return first!.flatMap(v => restProduct.map(r => [v, ...r]));
  }

  /**
   * 컬럼 정의 생성
   */
  private generateColumnDefs(generatedKeys: string[]): ColumnDef[] {
    const { rowFields } = this.config;

    // 행 필드 컬럼
    const rowColumnDefs: ColumnDef[] = rowFields.map(field => ({
      key: field,
      label: field,
      type: 'string' as const,
      width: 120,
    }));

    // 동적 생성된 값 컬럼
    const valueColumnDefs: ColumnDef[] = generatedKeys.map(key => ({
      key,
      label: this.formatColumnLabel(key),
      type: 'number' as const,
      width: 100,
    }));

    return [...rowColumnDefs, ...valueColumnDefs];
  }

  /**
   * 컬럼 레이블 포맷팅
   */
  private formatColumnLabel(key: string): string {
    // 예: "2023_Q1_sales" → "2023 Q1 Sales"
    return key
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  // ==========================================================================
  // Getter/Setter
  // ==========================================================================

  /**
   * 피봇 설정 반환
   */
  getConfig(): PivotConfig {
    return { ...this.config };
  }

  /**
   * 피봇 설정 변경
   */
  setConfig(config: PivotConfig): void {
    this.config = config;
  }

  /**
   * 피봇 모드 여부 (columnFields가 있으면 피봇)
   */
  isPivotMode(): boolean {
    return this.config.columnFields.length > 0;
  }
}
