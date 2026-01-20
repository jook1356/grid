/**
 * Row 클래스
 *
 * Body, 고정 영역 모두에서 사용되는 통합 행 추상화입니다.
 *
 * 핵심 개념:
 * - structural: true → UI 전용, 선택/인덱스 제외 (그룹 헤더, 소계 등)
 * - structural: false → 데이터 기반, 선택/인덱스 포함
 * - variant: 렌더링 힌트 (data, group-header, subtotal 등)
 * - pinned: 고정 위치 (top, bottom)
 *
 * Multi-Row 관계:
 * - Row는 데이터만 보유 (Multi-Row 레이아웃 로직 없음)
 * - MultiRowRenderer가 Row.getData()로 데이터를 가져와 스타일링
 */

import type { CellValue, ColumnDef, Row as RowData } from '../../types';
import type { ColumnState } from '../types';
import type { GridCore } from '../../core/GridCore';
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
 * Row 클래스
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

  // ==========================================================================
  // 공개 API - 렌더링
  // ==========================================================================

  /**
   * 행 높이 반환
   */
  getHeight(defaultHeight: number): number {
    return this.height ?? defaultHeight;
  }

  /**
   * 행 렌더링
   *
   * variant에 따라 적절한 렌더링 메서드를 호출합니다.
   * 커스텀 렌더러가 있으면 우선 사용합니다.
   */
  render(container: HTMLElement, context: RowRenderContext): void {
    // CSS 클래스 설정
    this.applyBaseStyles(container);

    // 커스텀 렌더러가 있으면 사용
    if (this.customRender) {
      this.customRender(container, context);
      return;
    }

    // variant별 기본 렌더링
    switch (this.variant) {
      case 'group-header':
        this.renderGroupHeader(container, context);
        break;
      case 'subtotal':
      case 'grandtotal':
        this.renderAggregate(container, context);
        break;
      case 'data':
      default:
        this.renderData(container, context);
    }
  }

  /**
   * 기존 DOM 요소 업데이트 (RowPool 재사용 시)
   *
   * render()와 동일하지만, 의미적으로 "업데이트"임을 명시합니다.
   */
  update(container: HTMLElement, context: RowRenderContext): void {
    this.render(container, context);
  }

  // ==========================================================================
  // Private - 기본 스타일 적용
  // ==========================================================================

  /**
   * 기본 CSS 클래스 적용
   */
  private applyBaseStyles(container: HTMLElement): void {
    // 기본 클래스
    container.classList.add('ps-row');

    // structural 행 표시
    container.classList.toggle('ps-structural', this.structural);

    // variant별 클래스
    if (this.variant !== 'data') {
      container.classList.add(`ps-row-${this.variant}`);
    }

    // 사용자 정의 클래스
    if (this.className) {
      container.classList.add(this.className);
    }
  }

  // ==========================================================================
  // Private - 데이터 행 렌더링
  // ==========================================================================

  /**
   * 데이터 행 렌더링
   */
  private renderData(container: HTMLElement, context: RowRenderContext): void {
    const { columnGroups, columnDefs } = context;

    // 그룹 헤더에서 재사용된 경우 구조 초기화
    if (!container.querySelector('.ps-cells-left')) {
      container.innerHTML = '';
    }

    // 그룹 헤더 스타일 제거
    container.classList.remove('ps-group-header');
    container.style.display = '';
    container.style.paddingLeft = '';

    // 셀 컨테이너 가져오기 또는 생성
    const leftContainer = this.getOrCreateCellContainer(container, 'ps-cells-left');
    const centerContainer = this.getOrCreateCellContainer(container, 'ps-cells-center');
    const rightContainer = this.getOrCreateCellContainer(container, 'ps-cells-right');

    // 각 영역별 셀 렌더링 (center만 indent 적용)
    this.renderCells(leftContainer, columnGroups.left, columnDefs, false);
    this.renderCells(centerContainer, columnGroups.center, columnDefs, true);
    this.renderCells(rightContainer, columnGroups.right, columnDefs, false);
  }

  /**
   * 셀 컨테이너 가져오기 또는 생성
   */
  private getOrCreateCellContainer(parent: HTMLElement, className: string): HTMLElement {
    let container = parent.querySelector(`.${className}`) as HTMLElement | null;
    if (!container) {
      container = document.createElement('div');
      container.className = className;
      parent.appendChild(container);
    }
    return container;
  }

  /**
   * 셀 렌더링
   */
  private renderCells(
    container: HTMLElement,
    columns: ColumnState[],
    columnDefs: Map<string, ColumnDef>,
    isCenter: boolean = false
  ): void {
    // 그룹 헤더에서 재사용된 경우 스타일 초기화
    container.style.display = '';

    // 그룹 헤더 콘텐츠가 남아있으면 제거
    const groupToggle = container.querySelector('.ps-group-toggle');
    if (groupToggle) {
      container.innerHTML = '';
    }

    // 중앙 컨테이너에 그룹 들여쓰기 적용 (CSS 변수 사용)
    if (isCenter) {
      container.style.paddingLeft = 'var(--ps-group-indent, 0px)';
    } else {
      container.style.paddingLeft = '';
    }

    // 필요한 셀 수 맞추기
    while (container.children.length > columns.length) {
      container.lastChild?.remove();
    }
    while (container.children.length < columns.length) {
      const cell = document.createElement('div');
      cell.className = 'ps-cell';
      container.appendChild(cell);
    }

    // 셀 내용 업데이트
    const cells = container.children;
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      if (!column) continue;

      const cell = cells[i] as HTMLElement;
      const value = this.data[column.key];
      const colDef = columnDefs.get(column.key);

      // 너비 설정 (CSS 변수 사용)
      cell.style.width = `var(--col-${column.key}-width, ${column.width}px)`;

      // 데이터 속성
      cell.dataset['columnKey'] = column.key;

      // 값 렌더링
      const displayValue = this.formatCellValue(value, colDef);
      cell.textContent = displayValue;
      cell.title = displayValue; // 툴팁
    }
  }

  /**
   * 셀 값 포맷팅
   */
  private formatCellValue(value: unknown, _colDef?: ColumnDef): string {
    if (value === null || value === undefined) {
      return '';
    }

    // TODO: 컬럼 정의에 formatter 추가 시 사용
    // 현재는 기본 문자열 변환만 수행

    // 기본 문자열 변환
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }

  // ==========================================================================
  // Private - 그룹 헤더 렌더링
  // ==========================================================================

  /**
   * 그룹 헤더 렌더링
   */
  private renderGroupHeader(container: HTMLElement, _context: RowRenderContext): void {
    const group = this.group;
    if (!group) {
      console.warn('Row: group-header variant requires group info');
      return;
    }

    // 그룹 헤더 스타일
    container.classList.add('ps-group-header');

    // 셀 컨테이너 가져오기 또는 생성 (데이터 행과 동일한 구조 유지)
    const leftContainer = this.getOrCreateCellContainer(container, 'ps-cells-left');
    const centerContainer = this.getOrCreateCellContainer(container, 'ps-cells-center');
    const rightContainer = this.getOrCreateCellContainer(container, 'ps-cells-right');

    // 왼쪽/오른쪽 컨테이너 비우기
    leftContainer.innerHTML = '';
    rightContainer.innerHTML = '';

    // 중앙 컨테이너에 그룹 헤더 콘텐츠 표시
    centerContainer.innerHTML = '';
    centerContainer.style.display = 'flex';
    centerContainer.style.alignItems = 'center';

    // 들여쓰기 (레벨에 따라)
    const indent = group.level * 20;
    centerContainer.style.paddingLeft = `${indent + 8}px`;

    // 토글 아이콘
    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'ps-group-toggle';
    toggleIcon.textContent = group.collapsed ? '▶' : '▼';
    toggleIcon.style.cursor = 'pointer';
    toggleIcon.style.marginRight = '8px';
    centerContainer.appendChild(toggleIcon);

    // 그룹 라벨
    const label = document.createElement('span');
    label.className = 'ps-group-label';
    label.innerHTML = `<strong>${group.value}</strong> (${group.itemCount} items)`;
    centerContainer.appendChild(label);

    // 집계 값 표시 (있는 경우)
    if (group.aggregates) {
      const aggregates = Object.entries(group.aggregates);
      if (aggregates.length > 0) {
        const aggContainer = document.createElement('span');
        aggContainer.className = 'ps-group-aggregates';
        aggContainer.style.marginLeft = '16px';
        aggContainer.style.color = '#666';

        for (const [key, value] of aggregates) {
          const aggSpan = document.createElement('span');
          aggSpan.className = 'ps-group-aggregate';
          aggSpan.style.marginRight = '12px';
          aggSpan.textContent = `${key}: ${this.formatAggregateValue(value)}`;
          aggContainer.appendChild(aggSpan);
        }

        centerContainer.appendChild(aggContainer);
      }
    }
  }

  // ==========================================================================
  // Private - 집계 행 렌더링
  // ==========================================================================

  /**
   * 집계 행 렌더링 (subtotal, grandtotal)
   */
  private renderAggregate(container: HTMLElement, context: RowRenderContext): void {
    const { columnGroups, gridCore } = context;

    // 집계 클래스 추가
    container.classList.add(
      this.variant === 'grandtotal' ? 'ps-grandtotal' : 'ps-subtotal'
    );

    // 셀 컨테이너 가져오기 또는 생성
    const leftContainer = this.getOrCreateCellContainer(container, 'ps-cells-left');
    const centerContainer = this.getOrCreateCellContainer(container, 'ps-cells-center');
    const rightContainer = this.getOrCreateCellContainer(container, 'ps-cells-right');

    // 집계 값 계산 (필요한 경우)
    const aggregateValues = this.calculateAggregates(gridCore);

    // 각 영역별 셀 렌더링 (집계 값 사용)
    this.renderAggregateCells(leftContainer, columnGroups.left, aggregateValues);
    this.renderAggregateCells(centerContainer, columnGroups.center, aggregateValues);
    this.renderAggregateCells(rightContainer, columnGroups.right, aggregateValues);
  }

  /**
   * 집계 셀 렌더링
   */
  private renderAggregateCells(
    container: HTMLElement,
    columns: ColumnState[],
    aggregateValues: Map<string, CellValue>
  ): void {
    // 필요한 셀 수 맞추기
    while (container.children.length > columns.length) {
      container.lastChild?.remove();
    }
    while (container.children.length < columns.length) {
      const cell = document.createElement('div');
      cell.className = 'ps-cell ps-aggregate-cell';
      container.appendChild(cell);
    }

    // 셀 내용 업데이트
    const cells = container.children;
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      if (!column) continue;

      const cell = cells[i] as HTMLElement;
      cell.style.width = `var(--col-${column.key}-width, ${column.width}px)`;
      cell.dataset['columnKey'] = column.key;

      // 집계 값이 있으면 표시
      if (aggregateValues.has(column.key)) {
        const value = aggregateValues.get(column.key);
        const config = this.aggregates?.find(a => a.columnKey === column.key);
        const displayValue = config?.formatter
          ? config.formatter(value ?? null)
          : this.formatAggregateValue(value);
        cell.textContent = displayValue;
        cell.classList.add('ps-has-aggregate');
      } else {
        cell.textContent = '';
        cell.classList.remove('ps-has-aggregate');
      }
    }
  }

  /**
   * 집계 값 계산
   */
  private calculateAggregates(gridCore: GridCore): Map<string, CellValue> {
    const result = new Map<string, CellValue>();

    if (!this.aggregates) return result;

    // 그룹 소계인 경우 그룹 내 데이터만, 총합계인 경우 전체 데이터
    const data: RowData[] = this.variant === 'grandtotal'
      ? [...gridCore.getAllData()]
      : this.getGroupData(gridCore);

    for (const config of this.aggregates) {
      const values = data
        .map((row: RowData) => row[config.columnKey])
        .filter((v): v is CellValue => v !== null && v !== undefined);
      const aggregatedValue = this.applyAggregateFunc(values, config.func);
      result.set(config.columnKey, aggregatedValue);
    }

    return result;
  }

  /**
   * 그룹 데이터 가져오기 (소계용)
   */
  private getGroupData(gridCore: GridCore): RowData[] {
    // TODO: 그룹 경로를 기반으로 해당 그룹의 데이터만 필터링
    // 현재는 전체 데이터 반환 (추후 GroupManager 연동 시 구현)
    return [...gridCore.getAllData()];
  }

  /**
   * 집계 함수 적용
   */
  private applyAggregateFunc(
    values: unknown[],
    func: 'sum' | 'avg' | 'min' | 'max' | 'count' | ((values: CellValue[]) => CellValue)
  ): CellValue {
    if (typeof func === 'function') {
      return func(values as CellValue[]);
    }

    const numbers = values.filter((v): v is number => typeof v === 'number');

    switch (func) {
      case 'sum':
        return numbers.reduce((a, b) => a + b, 0);
      case 'avg':
        return numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
      case 'min':
        return numbers.length > 0 ? Math.min(...numbers) : null;
      case 'max':
        return numbers.length > 0 ? Math.max(...numbers) : null;
      case 'count':
        return values.length;
      default:
        return null;
    }
  }

  /**
   * 집계 값 포맷팅
   */
  private formatAggregateValue(value: unknown): string {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'number') {
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return String(value);
  }
}

