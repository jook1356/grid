/**
 * RowRenderer - 행 렌더링 전담 클래스
 *
 * Row 클래스에서 분리된 렌더링 로직을 담당합니다.
 * Row는 순수 데이터/상태 객체로 남고, RowRenderer가 실제 DOM 렌더링을 수행합니다.
 *
 * 설계 원칙:
 * - Row = What (무엇을 렌더링할 것인가 - 데이터)
 * - RowRenderer = How (어떻게 렌더링할 것인가 - 렌더링 로직)
 * - ViewDataManager = Where (어디에 렌더링할 것인가 - 위치/레이아웃)
 *
 * 장점:
 * - 관심사 분리: 데이터와 렌더링이 분리되어 테스트 용이
 * - 렌더링 전략 교체 가능: Canvas 렌더링 등 다른 방식으로 교체 가능
 * - ViewDataManager와 호환: Row가 순수 데이터이므로 저장/캐싱 가능
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

import type { CellValue, ColumnDef, Row as RowData } from '../../types';
import type { ColumnState, ColumnGroups } from '../types';
import type { GridCore } from '../../core/GridCore';
import type { RowRenderContext, AggregateConfig, GroupInfo } from './types';
import type { Row } from './Row';

/**
 * 행 렌더러
 *
 * Row 인스턴스를 받아 DOM에 렌더링합니다.
 * variant에 따라 적절한 렌더링 메서드를 호출합니다.
 */
export class RowRenderer {
  // ==========================================================================
  // 공개 API
  // ==========================================================================

  /**
   * 행 렌더링
   *
   * Row의 variant에 따라 적절한 렌더링 메서드를 호출합니다.
   * 커스텀 렌더러가 있으면 우선 사용합니다.
   *
   * @param row - 렌더링할 Row 인스턴스
   * @param container - 렌더링할 DOM 컨테이너
   * @param context - 렌더링 컨텍스트
   */
  render(row: Row, container: HTMLElement, context: RowRenderContext): void {
    // 1. 컨테이너 초기화 (이전 variant 스타일/구조 제거)
    this.resetContainerForVariant(container);

    // 2. CSS 클래스 설정
    this.applyBaseStyles(row, container);

    // 3. 커스텀 렌더러가 있으면 사용
    const customRender = row.getCustomRender();
    if (customRender) {
      customRender(container, context);
      return;
    }

    // 4. variant별 기본 렌더링
    switch (row.variant) {
      case 'group-header':
        this.renderGroupHeader(row, container, context);
        break;
      case 'subtotal':
      case 'grandtotal':
        this.renderAggregate(row, container, context);
        break;
      case 'data':
      default:
        this.renderData(row, container, context);
    }
  }

  /**
   * 기존 DOM 요소 업데이트 (RowPool 재사용 시)
   *
   * render()와 동일하지만, 의미적으로 "업데이트"임을 명시합니다.
   */
  update(row: Row, container: HTMLElement, context: RowRenderContext): void {
    this.render(row, container, context);
  }

  // ==========================================================================
  // Private - 컨테이너 초기화 및 스타일 적용
  // ==========================================================================

  /**
   * 컨테이너 초기화 (RowPool 재사용 시)
   *
   * 이전 variant의 스타일/구조를 제거하고 공통 구조를 보장합니다.
   * 모든 variant 관련 초기화를 한 곳에서 처리합니다.
   */
  private resetContainerForVariant(container: HTMLElement): void {
    // 1. 모든 variant 관련 클래스 제거
    container.classList.remove(
      'ps-group-header',
      'ps-subtotal',
      'ps-grandtotal',
      'ps-row-group-header',
      'ps-row-subtotal',
      'ps-row-grandtotal',
      'ps-row-filter',
      'ps-row-custom',
      'ps-structural'
    );

    // 2. 인라인 스타일 초기화
    container.style.display = '';
    container.style.paddingLeft = '';

    // 3. 공통 DOM 구조 보장 (ps-cells-left/center/right)
    const hasStructure = container.querySelector('.ps-cells-left');
    if (!hasStructure) {
      // 그룹 헤더 등에서 직접 콘텐츠가 들어간 경우 초기화
      container.innerHTML = '';
    }
  }

  /**
   * 기본 CSS 클래스 적용
   */
  private applyBaseStyles(row: Row, container: HTMLElement): void {
    // 기본 클래스
    container.classList.add('ps-row');

    // structural 행 표시
    container.classList.toggle('ps-structural', row.structural);

    // variant별 클래스
    if (row.variant !== 'data') {
      container.classList.add(`ps-row-${row.variant}`);
    }

    // 사용자 정의 클래스
    const className = row.className;
    if (className) {
      container.classList.add(className);
    }
  }

  // ==========================================================================
  // Private - 데이터 행 렌더링
  // ==========================================================================

  /**
   * 데이터 행 렌더링
   */
  private renderData(row: Row, container: HTMLElement, context: RowRenderContext): void {
    const { columnGroups, columnDefs } = context;

    // 셀 컨테이너 가져오기 또는 생성
    const leftContainer = this.getOrCreateCellContainer(container, 'ps-cells-left');
    const centerContainer = this.getOrCreateCellContainer(container, 'ps-cells-center');
    const rightContainer = this.getOrCreateCellContainer(container, 'ps-cells-right');

    const data = row.getData();

    // 각 영역별 셀 렌더링 (center만 indent 적용)
    this.renderCells(leftContainer, columnGroups.left, columnDefs, data, false);
    this.renderCells(centerContainer, columnGroups.center, columnDefs, data, true);
    this.renderCells(rightContainer, columnGroups.right, columnDefs, data, false);
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
    data: Record<string, unknown>,
    isCenter: boolean = false
  ): void {
    // 그룹 헤더 콘텐츠가 남아있으면 제거 (ps-group-toggle 등)
    const hasNonCellContent = container.firstChild && 
      !(container.firstChild as HTMLElement).classList?.contains('ps-cell');
    if (hasNonCellContent) {
      container.innerHTML = '';
    }

    // 스타일 초기화
    container.style.display = '';
    
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
      const value = data[column.key];
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
  private renderGroupHeader(row: Row, container: HTMLElement, _context: RowRenderContext): void {
    const group = row.getGroup();
    if (!group) {
      console.warn('RowRenderer: group-header variant requires group info');
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
  private renderAggregate(row: Row, container: HTMLElement, context: RowRenderContext): void {
    const { columnGroups, gridCore } = context;

    // 집계 클래스 추가
    container.classList.add(
      row.variant === 'grandtotal' ? 'ps-grandtotal' : 'ps-subtotal'
    );

    // 셀 컨테이너 가져오기 또는 생성
    const leftContainer = this.getOrCreateCellContainer(container, 'ps-cells-left');
    const centerContainer = this.getOrCreateCellContainer(container, 'ps-cells-center');
    const rightContainer = this.getOrCreateCellContainer(container, 'ps-cells-right');

    // 집계 값 계산 (필요한 경우)
    const aggregateValues = this.calculateAggregates(row, gridCore);

    // 각 영역별 셀 렌더링 (집계 값 사용)
    this.renderAggregateCells(leftContainer, columnGroups.left, aggregateValues, row.getAggregates());
    this.renderAggregateCells(centerContainer, columnGroups.center, aggregateValues, row.getAggregates());
    this.renderAggregateCells(rightContainer, columnGroups.right, aggregateValues, row.getAggregates());
  }

  /**
   * 집계 셀 렌더링
   */
  private renderAggregateCells(
    container: HTMLElement,
    columns: ColumnState[],
    aggregateValues: Map<string, CellValue>,
    aggregateConfigs: AggregateConfig[] | null
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
        const config = aggregateConfigs?.find(a => a.columnKey === column.key);
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
  private calculateAggregates(row: Row, gridCore: GridCore): Map<string, CellValue> {
    const result = new Map<string, CellValue>();
    const aggregates = row.getAggregates();

    if (!aggregates) return result;

    // 그룹 소계인 경우 그룹 내 데이터만, 총합계인 경우 전체 데이터
    const data: RowData[] = row.variant === 'grandtotal'
      ? [...gridCore.getAllData()]
      : this.getGroupData(row, gridCore);

    for (const config of aggregates) {
      const values = data
        .map((rowData: RowData) => rowData[config.columnKey])
        .filter((v): v is CellValue => v !== null && v !== undefined);
      const aggregatedValue = this.applyAggregateFunc(values, config.func);
      result.set(config.columnKey, aggregatedValue);
    }

    return result;
  }

  /**
   * 그룹 데이터 가져오기 (소계용)
   *
   * 그룹 경로를 기반으로 해당 그룹에 속한 데이터만 필터링합니다.
   * 그룹 정보가 없으면 전체 데이터를 반환합니다.
   */
  private getGroupData(row: Row, gridCore: GridCore): RowData[] {
    const allData = [...gridCore.getAllData()];
    const group = row.getGroup();

    // 그룹 정보가 없으면 전체 데이터 반환
    if (!group || !group.path || group.path.length === 0) {
      return allData;
    }

    // 그룹 경로와 컬럼 정보를 기반으로 필터링
    // group.path = ['Engineering', 'Active'] (그룹 값 배열) - 다중 레벨 그룹 지원 시 사용
    // group.column = 'department' (마지막 그룹 컬럼)
    const { column: groupColumn, value: groupValue } = group;

    // 단일 레벨 그룹: 해당 컬럼의 값이 일치하는 데이터만
    // TODO: 다중 레벨 그룹 지원 시 path를 사용하여 전체 경로 매칭
    return allData.filter(rowData => {
      const rowValue = rowData[groupColumn];
      return rowValue === groupValue;
    });
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
