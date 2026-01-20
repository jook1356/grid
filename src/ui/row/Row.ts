/**
 * Row 클래스 - 순수 데이터/상태 객체
 *
 * Body, 고정 영역 모두에서 사용되는 통합 행 추상화입니다.
 * 렌더링 로직은 RowRenderer로 분리되었습니다.
 *
 * 핵심 개념:
 * - structural: true → UI 전용, 선택/인덱스 제외 (그룹 헤더, 소계 등)
 * - structural: false → 데이터 기반, 선택/인덱스 포함
 * - variant: 렌더링 힌트 (data, group-header, subtotal 등)
 * - pinned: 고정 위치 (top, bottom)
 *
 * 설계 원칙:
 * - Row = What (무엇을 렌더링할 것인가 - 데이터)
 * - RowRenderer = How (어떻게 렌더링할 것인가 - 렌더링 로직)
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

import type { CellValue } from '../../types';
import type {
  RowVariant,
  RowConfig,
  GroupInfo,
  AggregateConfig,
  RowRenderContext,
} from './types';

// Row ID 생성용 카운터
let rowIdCounter = 0;

/**
 * 고유 Row ID 생성
 */
function generateRowId(): string {
  return `row-${++rowIdCounter}`;
}

/**
 * Row 클래스 - 순수 데이터/상태 객체
 *
 * 렌더링 로직은 RowRenderer에서 담당합니다.
 */
export class Row {
  // ==========================================================================
  // 읽기 전용 속성
  // ==========================================================================

  /** 행 고유 ID */
  readonly id: string;

  /** 구조적 행 여부 (선택/인덱스 제외) */
  readonly structural: boolean;

  /** 행 변형 (렌더링 힌트) */
  readonly variant: RowVariant;

  /** 고정 위치 */
  readonly pinned: 'top' | 'bottom' | null;

  /** 행 높이 (null이면 기본값 사용) */
  readonly height: number | null;

  /** CSS 클래스 */
  readonly className: string | null;

  // ==========================================================================
  // 내부 상태
  // ==========================================================================

  /** 행 데이터 */
  private data: Record<string, unknown>;

  /** 그룹 정보 */
  private group: GroupInfo | null;

  /** 집계 설정 */
  private aggregates: AggregateConfig[] | null;

  /** 커스텀 렌더러 */
  private customRender: ((container: HTMLElement, context: RowRenderContext) => void) | null;

  // ==========================================================================
  // 생성자
  // ==========================================================================

  constructor(config: RowConfig) {
    this.id = config.id ?? generateRowId();
    this.structural = config.structural ?? false;
    this.variant = config.variant ?? 'data';
    this.pinned = config.pinned ?? null;
    this.height = config.height ?? null;
    this.className = config.className ?? null;
    this.data = config.data ?? {};
    this.group = config.group ?? null;
    this.aggregates = config.aggregates ?? null;
    this.customRender = config.render ?? null;
  }

  // ==========================================================================
  // 정적 팩토리 메서드
  // ==========================================================================

  /**
   * 집계 행 생성 (합계, 평균 등)
   *
   * 데이터 변경 시 자동으로 재계산됩니다.
   *
   * @param aggregates - 집계 설정 배열
   * @param options - 추가 옵션
   * @returns 집계 Row 인스턴스
   *
   * @example
   * ```ts
   * const sumRow = Row.createAggregateRow([
   *   { columnKey: 'salary', func: 'sum', formatter: v => '$' + v.toLocaleString() },
   *   { columnKey: 'bonus', func: 'sum' },
   * ], { pinned: 'bottom', variant: 'grandtotal' });
   * ```
   */
  static createAggregateRow(
    aggregates: AggregateConfig[],
    options: {
      id?: string;
      pinned?: 'top' | 'bottom';
      variant?: 'subtotal' | 'grandtotal';
      height?: number;
      className?: string;
      labelColumn?: string; // 라벨을 표시할 컬럼
      label?: string; // 라벨 텍스트 (기본: variant에 따라 '소계'/'총합계')
    } = {}
  ): Row {
    const variant = options.variant ?? 'subtotal';
    const label = options.label ?? (variant === 'grandtotal' ? '총합계' : '소계');

    // 라벨 데이터 설정
    const data: Record<string, unknown> = {};
    if (options.labelColumn) {
      data[options.labelColumn] = label;
    }

    return new Row({
      id: options.id,
      structural: true,
      variant,
      pinned: options.pinned ?? 'bottom',
      height: options.height,
      className: options.className,
      aggregates,
      data,
    });
  }

  /**
   * 총합계 행 생성 (편의 메서드)
   *
   * @param aggregates - 집계 설정 배열
   * @param options - 추가 옵션
   * @returns 총합계 Row 인스턴스
   *
   * @example
   * ```ts
   * const totalRow = Row.createGrandTotalRow([
   *   { columnKey: 'amount', func: 'sum' },
   *   { columnKey: 'count', func: 'count' },
   * ]);
   * ```
   */
  static createGrandTotalRow(
    aggregates: AggregateConfig[],
    options: Omit<Parameters<typeof Row.createAggregateRow>[1], 'variant'> = {}
  ): Row {
    return Row.createAggregateRow(aggregates, { ...options, variant: 'grandtotal' });
  }

  /**
   * 소계 행 생성 (편의 메서드)
   *
   * @param aggregates - 집계 설정 배열
   * @param options - 추가 옵션
   * @returns 소계 Row 인스턴스
   */
  static createSubtotalRow(
    aggregates: AggregateConfig[],
    options: Omit<Parameters<typeof Row.createAggregateRow>[1], 'variant'> = {}
  ): Row {
    return Row.createAggregateRow(aggregates, { ...options, variant: 'subtotal' });
  }

  // ==========================================================================
  // 공개 API - 데이터 접근
  // ==========================================================================

  /**
   * 행 데이터 반환
   */
  getData(): Record<string, unknown> {
    return this.data;
  }

  /**
   * 행 데이터 설정
   */
  setData(data: Record<string, unknown>): void {
    this.data = data;
  }

  /**
   * 특정 필드 값 반환
   */
  getValue(key: string): unknown {
    return this.data[key];
  }

  /**
   * 특정 필드 값 설정
   */
  setValue(key: string, value: unknown): void {
    this.data[key] = value;
  }

  // ==========================================================================
  // 공개 API - 그룹 관련
  // ==========================================================================

  /**
   * 그룹 정보 반환
   */
  getGroup(): GroupInfo | null {
    return this.group;
  }

  /**
   * 그룹 접힘 상태 반환
   */
  isCollapsed(): boolean {
    return this.group?.collapsed ?? false;
  }

  /**
   * 그룹 접힘 상태 토글
   * @returns 새로운 접힘 상태
   */
  toggleCollapsed(): boolean {
    if (this.group) {
      this.group.collapsed = !this.group.collapsed;
      return this.group.collapsed;
    }
    return false;
  }

  /**
   * 그룹 접힘 상태 설정
   */
  setCollapsed(collapsed: boolean): void {
    if (this.group) {
      this.group.collapsed = collapsed;
    }
  }

  // ==========================================================================
  // 공개 API - 집계 관련
  // ==========================================================================

  /**
   * 집계 설정 반환
   */
  getAggregates(): AggregateConfig[] | null {
    return this.aggregates;
  }

  /**
   * 집계 설정 변경
   *
   * 설정 변경 후 renderPinnedRows()를 호출하면 새 설정으로 재계산됩니다.
   */
  setAggregates(aggregates: AggregateConfig[]): void {
    this.aggregates = aggregates;
  }

  /**
   * 집계 설정 추가
   */
  addAggregate(config: AggregateConfig): void {
    if (!this.aggregates) {
      this.aggregates = [];
    }
    // 같은 컬럼의 기존 설정 제거
    this.aggregates = this.aggregates.filter(a => a.columnKey !== config.columnKey);
    this.aggregates.push(config);
  }

  /**
   * 집계 설정 제거
   */
  removeAggregate(columnKey: string): void {
    if (this.aggregates) {
      this.aggregates = this.aggregates.filter(a => a.columnKey !== columnKey);
    }
  }

  /**
   * 계산된 집계 값 반환
   *
   * RowRenderer에서 GridCore 데이터를 기반으로 집계 값을 계산합니다.
   * 이 메서드는 호환성을 위해 유지되지만, 실제 계산은 RowRenderer에서 수행됩니다.
   *
   * @deprecated RowRenderer.calculateAggregates() 사용 권장
   * @param _gridCore - GridCore 인스턴스 (미사용, RowRenderer에서 처리)
   * @returns 빈 Map (실제 계산은 RowRenderer에서)
   */
  getComputedAggregates(_gridCore: unknown): Map<string, CellValue> {
    // 호환성을 위해 빈 Map 반환
    // 실제 집계는 RowRenderer에서 수행됨
    console.warn('Row.getComputedAggregates() is deprecated. Use RowRenderer for rendering.');
    return new Map();
  }

  // ==========================================================================
  // 공개 API - 렌더링 관련 (RowRenderer에서 사용)
  // ==========================================================================

  /**
   * 행 높이 반환
   */
  getHeight(defaultHeight: number): number {
    return this.height ?? defaultHeight;
  }

  /**
   * 커스텀 렌더러 반환
   *
   * RowRenderer에서 커스텀 렌더러가 있는지 확인하고 사용합니다.
   */
  getCustomRender(): ((container: HTMLElement, context: RowRenderContext) => void) | null {
    return this.customRender;
  }

  // ==========================================================================
  // 호환성 API (deprecated)
  // ==========================================================================

  /**
   * 행 렌더링 (deprecated)
   *
   * RowRenderer를 사용하세요.
   *
   * @deprecated RowRenderer.render() 사용 권장
   */
  render(container: HTMLElement, context: RowRenderContext): void {
    console.warn('Row.render() is deprecated. Use RowRenderer.render() instead.');
    // 호환성을 위해 RowRenderer 인스턴스 생성하여 렌더링
    // 실제 프로덕션에서는 RowRenderer 인스턴스를 재사용해야 함
    const { RowRenderer } = require('./RowRenderer');
    const renderer = new RowRenderer();
    renderer.render(this, container, context);
  }

  /**
   * 기존 DOM 요소 업데이트 (deprecated)
   *
   * @deprecated RowRenderer.update() 사용 권장
   */
  update(container: HTMLElement, context: RowRenderContext): void {
    this.render(container, context);
  }
}
