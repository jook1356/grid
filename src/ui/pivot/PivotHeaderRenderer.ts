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
 *
 * @example
 * const renderer = new PivotHeaderRenderer(container, {
 *   headerTree: pivotResult.columnHeaderTree,
 *   levelCount: pivotResult.headerLevelCount,
 *   rowHeaderColumns: pivotResult.rowHeaderColumns,
 *   headerHeight: 40,
 * });
 */

import type { ColumnDef } from '../../types';
import type { PivotHeaderNode } from '../../types/pivot.types';
import { DEFAULT_COLUMN_WIDTH } from '../utils/cssUtils';

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

  /** 가로 스크롤 오프셋 업데이트 콜백 */
  onScrollUpdate?: (scrollLeft: number) => void;
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

  // 컬럼 너비 (리프 노드 기준)
  private columnWidths: Map<string, number> = new Map();

  constructor(container: HTMLElement, options: PivotHeaderRendererOptions) {
    this.container = container;
    this.options = options;

    // 컬럼 너비 초기화
    for (const col of options.dataColumns) {
      this.columnWidths.set(col.key, DEFAULT_COLUMN_WIDTH);
    }

    // DOM 구조 생성
    this.headerElement = this.createHeaderElement();
    this.leftContainer = this.createLeftContainer();
    this.centerWrapper = this.createCenterWrapper();
    this.centerContainer = this.createCenterContainer();

    this.centerWrapper.appendChild(this.centerContainer);
    this.headerElement.appendChild(this.leftContainer);
    this.headerElement.appendChild(this.centerWrapper);
    this.container.appendChild(this.headerElement);

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

    const { headerTree, levelCount, headerHeight } = this.options;

    // 각 레벨별로 행 생성
    for (let level = 0; level < levelCount; level++) {
      const row = this.createLevelRow(headerTree, level, headerHeight);
      this.centerContainer.appendChild(row);
    }

    // 전체 너비 설정
    const totalWidth = this.calculateTotalWidth();
    this.centerContainer.style.width = `${totalWidth}px`;
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
      const width = this.calculateNodeWidth(node);
      const cell = this.createHeaderCell(node.label, width, height);

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
   * 노드의 너비 계산 (리프 노드들의 너비 합)
   */
  private calculateNodeWidth(node: PivotHeaderNode): number {
    if (node.isLeaf && node.columnKey) {
      return this.columnWidths.get(node.columnKey) || 100;
    }

    // 자식들의 너비 합
    let totalWidth = 0;
    const leaves = this.collectLeafNodes(node);
    for (const leaf of leaves) {
      if (leaf.columnKey) {
        totalWidth += this.columnWidths.get(leaf.columnKey) || 100;
      }
    }
    return totalWidth;
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
   * 전체 너비 계산
   */
  private calculateTotalWidth(): number {
    let total = 0;
    for (const width of this.columnWidths.values()) {
      total += width;
    }
    return total;
  }

  /**
   * 헤더 셀 생성
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
}

