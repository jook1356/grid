/**
 * PivotHeaderRenderer - 피벗 그리드 헤더 렌더링
 *
 * 피벗 그리드의 다중 레벨 컬럼 헤더를 렌더링합니다.
 * PivotHeaderNode 트리 구조를 기반으로 각 레벨을 행으로 렌더링합니다.
 *
 * 특징:
 * - columnFields 개수 + valueFields 레벨 자동 계산
 * - 트리 노드의 colspan 기반으로 셀 병합
 * - 스크롤과 연동 (행 헤더는 고정)
 * - valueField 기준 CSS 변수 공유 (성능 최적화)
 *   - 각 valueField당 하나의 CSS 변수 사용: --pivot-col-{valueField}-width
 *   - 대표 셀 하나만 ResizeObserver로 감시
 *
 * @example
 * const renderer = new PivotHeaderRenderer(container, {
 *   headerTree: pivotResult.columnHeaderTree,
 *   levelCount: pivotResult.headerLevelCount,
 *   rowHeaderColumns: pivotResult.rowHeaderColumns,
 *   headerHeight: 40,
 *   fieldDefs: fieldDefMap,
 *   columnFieldCount: 2,
 * });
 */

import type { ColumnDef, FieldDef } from '../../types';
import type { PivotHeaderNode } from '../../types/pivot.types';
import { parsePivotColumnKey } from '../../types/pivot.types';
import { DEFAULT_COLUMN_WIDTH, toCSSValue } from '../utils/cssUtils';

/**
 * PivotHeaderRenderer 설정
 */
export interface PivotHeaderRendererOptions {
  /** 피벗 헤더 트리 (루트 노드) */
  headerTree: PivotHeaderNode;

  /** 헤더 레벨 수 */
  levelCount: number;

  /** 행 헤더 컬럼 정의 (rowFields 기준, pinned: 'left') */
  rowHeaderColumns: ColumnDef[];

  /** 데이터 컬럼 정의 (리프 노드 기준) */
  dataColumns: ColumnDef[];

  /** 각 레벨의 높이 (픽셀) */
  headerHeight: number;

  /** 필드 정의 맵 (width 정보 참조용) */
  fieldDefs: Map<string, FieldDef>;

  /** columnFields 개수 (columnKey 파싱용) */
  columnFieldCount: number;

  /** 그리드 컨테이너 요소 (CSS 변수 설정용) */
  gridContainer: HTMLElement;

  /** 가로 스크롤 오프셋 업데이트 콜백 */
  onScrollUpdate?: (scrollLeft: number) => void;

  /** 컬럼 너비 변경 콜백 (가상 스크롤용) */
  onColumnWidthChange?: (valueField: string, width: number) => void;
}

/**
 * 피벗 헤더 렌더러
 */
export class PivotHeaderRenderer {
  private readonly container: HTMLElement;
  private readonly options: PivotHeaderRendererOptions;

  // DOM 요소
  private headerElement: HTMLElement;
  private leftContainer: HTMLElement;
  private centerWrapper: HTMLElement;
  private centerContainer: HTMLElement;

  // 컬럼 너비 (리프 노드 기준) - 기존 호환성 유지
  private columnWidths: Map<string, number> = new Map();

  // valueField별 대표 셀 추적 (ResizeObserver 감시 대상)
  private representativeCells: Map<string, HTMLElement> = new Map();

  // valueField별 현재 너비 캐시
  private valueFieldWidths: Map<string, number> = new Map();

  // ResizeObserver (valueField 대표 셀 전용)
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, options: PivotHeaderRendererOptions) {
    this.container = container;
    this.options = options;

    // 컬럼 너비 초기화 (기존 호환성)
    for (const col of options.dataColumns) {
      this.columnWidths.set(col.key, DEFAULT_COLUMN_WIDTH);
    }

    // ResizeObserver 설정
    this.setupResizeObserver();

    // DOM 구조 생성
    this.headerElement = this.createHeaderElement();
    this.leftContainer = this.createLeftContainer();
    this.centerWrapper = this.createCenterWrapper();
    this.centerContainer = this.createCenterContainer();

    this.centerWrapper.appendChild(this.centerContainer);
    this.headerElement.appendChild(this.leftContainer);
    this.headerElement.appendChild(this.centerWrapper);
    this.container.appendChild(this.headerElement);

    // CSS 변수 초기화
    this.initializeCSSVariables();

    // 초기 렌더링
    this.render();
  }

  // ===========================================================================
  // 공개 API
  // ===========================================================================

  /**
   * 헤더 다시 렌더링
   */
  render(): void {
    this.renderLeftHeader();
    this.renderCenterHeader();
  }

  /**
   * 스크롤 위치 업데이트
   */
  updateScrollPosition(scrollLeft: number): void {
    this.centerWrapper.scrollLeft = scrollLeft;
  }

  /**
   * 헤더 트리 업데이트
   */
  updateHeaderTree(tree: PivotHeaderNode, levelCount: number): void {
    (this.options as { headerTree: PivotHeaderNode }).headerTree = tree;
    (this.options as { levelCount: number }).levelCount = levelCount;
    this.render();
  }

  /**
   * 컬럼 너비 업데이트
   */
  updateColumnWidth(columnKey: string, width: number): void {
    this.columnWidths.set(columnKey, width);
    this.render();
  }

  /**
   * 총 헤더 높이 반환
   */
  getTotalHeight(): number {
    return this.options.headerHeight * this.options.levelCount;
  }

  /**
   * 리소스 해제
   */
  destroy(): void {
    // ResizeObserver 정리
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // 대표 셀 맵 정리
    this.representativeCells.clear();
    this.valueFieldWidths.clear();

    this.headerElement.remove();
  }

  // ===========================================================================
  // DOM 생성
  // ===========================================================================

  private createHeaderElement(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ps-pivot-header';
    el.style.cssText = `
      display: flex;
      flex-direction: row;
      position: relative;
      background: var(--ps-header-bg, #f5f5f5);
      // border-bottom: 1px solid var(--ps-border-color, #e0e0e0);
    `;
    return el;
  }

  private createLeftContainer(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ps-pivot-header-left';
    el.style.cssText = `
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      position: sticky;
      left: 0;
      z-index: 2;
      background: var(--ps-header-bg, #f5f5f5);
      box-shadow: 2px 0 4px var(--ps-shadow-color, rgba(0, 0, 0, 0.1));
    `;
    return el;
  }

  private createCenterWrapper(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ps-pivot-header-center-wrapper';
    el.style.cssText = `
      flex: 1;
      overflow: hidden;
      position: relative;
    `;
    return el;
  }

  private createCenterContainer(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ps-pivot-header-center';
    el.style.cssText = `
      display: flex;
      flex-direction: column;
      width: 100%;
    `;
    return el;
  }

  // ===========================================================================
  // 렌더링
  // ===========================================================================

  /**
   * 왼쪽 영역 (행 헤더 컬럼) 렌더링
   */
  private renderLeftHeader(): void {
    this.leftContainer.innerHTML = '';

    const { rowHeaderColumns, headerHeight, levelCount } = this.options;

    // 행 헤더 컬럼들은 모든 레벨을 병합하여 하나의 셀로 표시
    const totalHeight = headerHeight * levelCount;

    // 행 헤더 컬럼들을 가로로 배치
    const rowWrapper = document.createElement('div');
    rowWrapper.style.cssText = `
      display: flex;
      height: ${totalHeight}px;
    `;

    for (const col of rowHeaderColumns) {
      const cell = this.createHeaderCell(col.header || col.key, DEFAULT_COLUMN_WIDTH, totalHeight);
      cell.style.borderRight = '1px solid var(--ps-border-color, #e0e0e0)';
      rowWrapper.appendChild(cell);
    }

    this.leftContainer.appendChild(rowWrapper);
  }

  /**
   * 중앙 영역 (피벗 컬럼) 렌더링
   */
  private renderCenterHeader(): void {
    this.centerContainer.innerHTML = '';

    // 대표 셀 맵 초기화 (다시 렌더링 시 새로 등록)
    for (const cell of this.representativeCells.values()) {
      this.resizeObserver?.unobserve(cell);
    }
    this.representativeCells.clear();

    const { headerTree, levelCount, headerHeight } = this.options;

    // 각 레벨별로 행 생성
    for (let level = 0; level < levelCount; level++) {
      const row = this.createLevelRow(headerTree, level, headerHeight);
      this.centerContainer.appendChild(row);
    }

    // width: max-content로 자식 너비에 맞게 자동 설정됨
  }

  /**
   * 특정 레벨의 헤더 행 생성
   */
  private createLevelRow(tree: PivotHeaderNode, targetLevel: number, height: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ps-pivot-header-row';
    row.style.cssText = `
      display: flex;
      height: ${height}px;
    `;

    // 해당 레벨의 노드들 수집
    const nodesAtLevel = this.collectNodesAtLevel(tree, targetLevel);

    for (const node of nodesAtLevel) {
      // CSS 변수 기반 헤더 셀 생성
      const cell = this.createPivotHeaderCell(node, height);

      // 마지막이 아니면 오른쪽 경계선
      cell.style.borderRight = '1px solid var(--ps-border-color, #e0e0e0)';

      row.appendChild(cell);
    }

    return row;
  }

  /**
   * 특정 레벨의 노드들 수집 (트리 순회)
   */
  private collectNodesAtLevel(root: PivotHeaderNode, targetLevel: number): PivotHeaderNode[] {
    const result: PivotHeaderNode[] = [];

    const traverse = (node: PivotHeaderNode) => {
      // 루트 노드(level = -1)는 건너뜀
      if (node.level === targetLevel) {
        result.push(node);
        return;
      }

      // 자식 노드 탐색
      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(root);
    return result;
  }

  /**
   * 리프 노드 수집
   */
  private collectLeafNodes(node: PivotHeaderNode): PivotHeaderNode[] {
    if (node.isLeaf) {
      return [node];
    }

    const result: PivotHeaderNode[] = [];
    for (const child of node.children) {
      result.push(...this.collectLeafNodes(child));
    }
    return result;
  }

  /**
   * 전체 너비 계산 (CSS calc 문자열)
   *
   * 모든 리프 노드들의 CSS 변수를 합산합니다.
   */
  private calculateTotalWidthCSS(): string {
    const { headerTree, columnFieldCount, dataColumns } = this.options;

    // 리프 노드가 없으면 기본값
    if (dataColumns.length === 0) {
      return '0px';
    }

    // 모든 리프 노드 수집
    const leaves = this.collectLeafNodes(headerTree);
    if (leaves.length === 0) {
      return '0px';
    }

    // 각 리프의 CSS 변수 참조 생성
    const terms = leaves.map((leaf) => {
      if (!leaf.columnKey) return `${DEFAULT_COLUMN_WIDTH}px`;
      const { valueField } = parsePivotColumnKey(leaf.columnKey, columnFieldCount);
      return `var(--pivot-col-${valueField}-width)`;
    });

    // 단일 리프면 calc() 불필요
    if (terms.length === 1) {
      return terms[0]!;
    }

    return `calc(${terms.join(' + ')})`;
  }

  /**
   * 헤더 셀 생성 (고정 너비용 - 행 헤더 등)
   */
  private createHeaderCell(label: string, width: number, height: number): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'ps-pivot-header-cell';
    cell.style.cssText = `
      width: ${width}px;
      min-width: ${width}px;
      height: ${height}px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 8px;
      font-weight: 500;
      font-size: 13px;
      color: var(--ps-header-text, #333);
      background: var(--ps-header-bg, #f5f5f5);
      box-sizing: border-box;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border-bottom: 1px solid var(--ps-border-color, #e0e0e0);
    `;
    cell.textContent = label;
    cell.title = label; // 툴팁

    return cell;
  }

  // ===========================================================================
  // CSS 변수 및 ResizeObserver (Private)
  // ===========================================================================

  /**
   * ResizeObserver 설정
   *
   * valueField별 대표 셀만 감시합니다.
   * 대표 셀의 너비가 변경되면 해당 valueField의 CSS 변수를 업데이트합니다.
   */
  private setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;

    const { gridContainer, onColumnWidthChange } = this.options;

    this.resizeObserver = new ResizeObserver((entries) => {
      requestAnimationFrame(() => {
        for (const entry of entries) {
          const cell = entry.target as HTMLElement;
          const valueField = cell.dataset['valueField'];
          if (!valueField) continue;

          // borderBoxSize 사용 시 실제 렌더링된 픽셀과 미세한 차이(0.02px 등)가 발생할 수 있음
          // getBoundingClientRect().width를 사용하여 렌더링된 실제 크기와 정확히 일치시킴
          const width = cell.getBoundingClientRect().width;
          if (width <= 0) continue;

          // 기존 너비와 비교하여 변경된 경우에만 업데이트 (성능 최적화)
          const prevWidth = this.valueFieldWidths.get(valueField);
          if (prevWidth === width) continue;

          // CSS 변수 업데이트
          gridContainer.style.setProperty(`--pivot-col-${valueField}-width`, `${width}px`);

          // 캐시 업데이트
          this.valueFieldWidths.set(valueField, width);

          // 콜백 호출 (가상 스크롤용 ColumnState 업데이트)
          onColumnWidthChange?.(valueField, width);
        }
      });
    });
  }

  /**
   * CSS 변수 초기화
   *
   * 초기 CSS 변수는 기본 픽셀 값으로 설정합니다.
   * 헤더 셀이 렌더링된 후 ResizeObserver가 실제 픽셀 값으로 업데이트합니다.
   *
   * 흐름:
   * 1. 헤더 셀: 사용자 설정 width 직접 적용 (예: '10%', '150px')
   * 2. ResizeObserver: 헤더 셀의 실제 픽셀 크기 감지
   * 3. CSS 변수: 실제 픽셀 값으로 업데이트 (예: '120px')
   * 4. 데이터 셀: CSS 변수(픽셀) 참조
   */
  private initializeCSSVariables(): void {
    const { dataColumns, columnFieldCount, gridContainer } = this.options;

    // valueField 목록 수집
    const valueFields = new Set<string>();
    for (const col of dataColumns) {
      const { valueField } = parsePivotColumnKey(col.key, columnFieldCount);
      valueFields.add(valueField);
    }

    // 초기 CSS 변수 설정 (기본 픽셀 값)
    // 헤더 셀 렌더링 후 ResizeObserver가 실제 값으로 업데이트함
    for (const vf of valueFields) {
      gridContainer.style.setProperty(`--pivot-col-${vf}-width`, `${DEFAULT_COLUMN_WIDTH}px`);

      // 초기 너비 캐시
      this.valueFieldWidths.set(vf, DEFAULT_COLUMN_WIDTH);
      this.columnWidths.set(vf, DEFAULT_COLUMN_WIDTH); // 기존 호환성
    }
  }

  /**
   * 피봇 헤더 셀 생성
   *
   * 리프 노드: 사용자가 설정한 width 직접 적용 (반응형 유지)
   *   → ResizeObserver가 크기 변화 감지 → CSS 변수 업데이트
   * 비리프 노드: 자식 리프들의 CSS 변수를 calc()로 합산
   */
  private createPivotHeaderCell(node: PivotHeaderNode, height: number): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'ps-pivot-header-cell';

    const { columnFieldCount, fieldDefs } = this.options;
    const isLeaf = node.isLeaf && node.columnKey;

    // 기본 스타일
    cell.style.cssText = `
      height: ${height}px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 8px;
      font-weight: 500;
      font-size: 13px;
      color: var(--ps-header-text, #333);
      background: var(--ps-header-bg, #f5f5f5);
      box-sizing: border-box;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border-bottom: 1px solid var(--ps-border-color, #e0e0e0);
      flex-shrink: 0;
    `;

    if (isLeaf) {
      // 리프 노드: 사용자가 설정한 width 직접 적용 (반응형)
      const { valueField } = parsePivotColumnKey(node.columnKey!, columnFieldCount);
      const fieldDef = fieldDefs.get(valueField);

      // width 직접 적용 (예: '10%', '150px', 'auto')
      const widthValue = toCSSValue(fieldDef?.width) ?? `${DEFAULT_COLUMN_WIDTH}px`;
      cell.style.width = widthValue;

      // minWidth, maxWidth 직접 적용
      const minWidthValue = toCSSValue(fieldDef?.minWidth);
      const maxWidthValue = toCSSValue(fieldDef?.maxWidth);
      if (minWidthValue) {
        cell.style.minWidth = minWidthValue;
      }
      if (maxWidthValue) {
        cell.style.maxWidth = maxWidthValue;
      }

      // data 속성 설정 (ResizeObserver 식별용)
      cell.dataset['valueField'] = valueField;
      cell.dataset['columnKey'] = node.columnKey!;

      // 대표 셀 등록 (해당 valueField의 첫 번째 셀만)
      // ResizeObserver가 크기 변화 감지 → CSS 변수 업데이트
      if (!this.representativeCells.has(valueField)) {
        this.representativeCells.set(valueField, cell);
        this.resizeObserver?.observe(cell);
      }
    } else {
      // 비리프 노드: 자식 리프들의 CSS 변수 합산
      const widthCalc = this.calculateNodeWidthCSS(node);
      cell.style.width = widthCalc;
      cell.style.minWidth = widthCalc;
    }

    cell.textContent = node.label;
    cell.title = node.label; // 툴팁

    return cell;
  }

  /**
   * 노드의 너비를 CSS calc() 문자열로 계산
   *
   * 리프 노드: var(--pivot-col-{valueField}-width)
   * 비리프 노드: calc(var(...) + var(...) + ...)
   */
  private calculateNodeWidthCSS(node: PivotHeaderNode): string {
    const { columnFieldCount } = this.options;

    if (node.isLeaf && node.columnKey) {
      const { valueField } = parsePivotColumnKey(node.columnKey, columnFieldCount);
      return `var(--pivot-col-${valueField}-width)`;
    }

    // 자식 리프 노드들 수집
    const leaves = this.collectLeafNodes(node);
    if (leaves.length === 0) {
      return `${DEFAULT_COLUMN_WIDTH}px`;
    }

    // 각 리프의 CSS 변수 참조 생성
    const terms = leaves.map((leaf) => {
      if (!leaf.columnKey) return `${DEFAULT_COLUMN_WIDTH}px`;
      const { valueField } = parsePivotColumnKey(leaf.columnKey, columnFieldCount);
      return `var(--pivot-col-${valueField}-width)`;
    });

    // 단일 리프면 calc() 불필요
    if (terms.length === 1) {
      return terms[0]!;
    }

    return `calc(${terms.join(' + ')})`;
  }
}

