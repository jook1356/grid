/**
 * RowPool - 행 DOM 요소 풀링
 *
 * 스크롤 시 행 DOM 요소를 재사용하여 GC 부담을 줄입니다.
 * 화면 밖으로 나간 행은 풀에 반환되고, 새로운 행이 필요하면 풀에서 가져옵니다.
 *
 * Single-Row와 Multi-Row 모드 모두 지원합니다.
 */

import type { RowTemplate } from '../../types';

/**
 * 행 풀 클래스
 */
export class RowPool {
  /** 사용 가능한 행 요소 풀 */
  private pool: HTMLElement[] = [];

  /** 현재 활성화된 행 (인덱스 → 요소) */
  private activeRows: Map<number, HTMLElement> = new Map();

  /** 행 컨테이너 */
  private container: HTMLElement;

  /** 셀 수 (Left, Center, Right 컨테이너 생성용) */
  private columnCount: number;

  /** Multi-Row 템플릿 (null이면 Single-Row 모드) */
  private multiRowTemplate: RowTemplate | null = null;

  /** Multi-Row 그리드 컬럼 수 */
  private gridColumnCount: number = 0;

  constructor(container: HTMLElement, columnCount: number) {
    this.container = container;
    this.columnCount = columnCount;
  }

  /**
   * Multi-Row 템플릿 설정
   *
   * 템플릿이 변경되면 기존 풀을 초기화합니다.
   * (구조가 완전히 다르므로 재사용 불가)
   */
  setMultiRowTemplate(template: RowTemplate | null): void {
    // 템플릿이 같으면 무시
    if (this.multiRowTemplate === template) return;

    this.multiRowTemplate = template;

    // 그리드 컬럼 수 계산
    if (template) {
      const firstRow = template.layout[0] ?? [];
      this.gridColumnCount = firstRow.reduce((sum, item) => sum + (item.colSpan ?? 1), 0);
    } else {
      this.gridColumnCount = 0;
    }

    // 구조 변경 시 풀 초기화 (활성 행은 유지하되, 풀은 비움)
    this.pool = [];
  }

  /**
   * Multi-Row 모드인지 확인
   */
  isMultiRowMode(): boolean {
    return this.multiRowTemplate !== null;
  }

  /**
   * 행 요소 획득 (풀에서 재사용 또는 새로 생성)
   */
  acquire(rowIndex: number): HTMLElement {
    // 이미 활성화된 행이면 그대로 반환
    const existing = this.activeRows.get(rowIndex);
    if (existing) {
      return existing;
    }

    // 풀에서 가져오거나 새로 생성
    let row = this.pool.pop();
    if (!row) {
      row = this.createRowElement();
    }

    this.activeRows.set(rowIndex, row);
    this.container.appendChild(row);

    return row;
  }

  /**
   * 행 요소 반환 (풀로 돌려보냄)
   */
  release(rowIndex: number): void {
    const row = this.activeRows.get(rowIndex);
    if (row) {
      this.activeRows.delete(rowIndex);
      row.remove();
      this.pool.push(row);
    }
  }

  /**
   * 보이는 범위 업데이트
   *
   * 범위 밖의 행을 반환하고, 범위 내 새 행을 획득합니다.
   */
  updateVisibleRange(startIndex: number, endIndex: number): Map<number, HTMLElement> {
    // 범위 밖 행 반환
    const indicesToRelease: number[] = [];
    for (const index of this.activeRows.keys()) {
      if (index < startIndex || index >= endIndex) {
        indicesToRelease.push(index);
      }
    }
    for (const index of indicesToRelease) {
      this.release(index);
    }

    // 범위 내 새 행 획득
    for (let i = startIndex; i < endIndex; i++) {
      if (!this.activeRows.has(i)) {
        this.acquire(i);
      }
    }

    return this.activeRows;
  }

  /**
   * 특정 행 요소 가져오기
   */
  getRow(rowIndex: number): HTMLElement | undefined {
    return this.activeRows.get(rowIndex);
  }

  /**
   * 모든 활성 행 가져오기
   */
  getActiveRows(): Map<number, HTMLElement> {
    return this.activeRows;
  }

  /**
   * 컬럼 수 업데이트 (컬럼 변경 시)
   */
  updateColumnCount(count: number): void {
    this.columnCount = count;
    // 기존 풀의 행들은 다시 생성해야 하므로 비움
    this.pool = [];
  }

  /**
   * 풀 정리
   */
  clear(): void {
    // 모든 활성 행 제거
    for (const row of this.activeRows.values()) {
      row.remove();
    }
    this.activeRows.clear();
    this.pool = [];
  }

  /**
   * 리소스 해제
   */
  destroy(): void {
    this.clear();
  }

  /**
   * 행 요소 생성 (템플릿)
   *
   * Multi-Row 모드면 Grid 컨테이너, 아니면 기존 Left/Center/Right 구조
   */
  private createRowElement(): HTMLElement {
    if (this.multiRowTemplate) {
      return this.createMultiRowContainer();
    }
    return this.createSingleRowElement();
  }

  /**
   * Single-Row 행 요소 생성
   */
  private createSingleRowElement(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ps-row';

    // Left cells container (고정)
    const left = document.createElement('div');
    left.className = 'ps-cells-left';
    row.appendChild(left);

    // Center cells container (스크롤)
    const center = document.createElement('div');
    center.className = 'ps-cells-center';
    row.appendChild(center);

    // Right cells container (고정)
    const right = document.createElement('div');
    right.className = 'ps-cells-right';
    row.appendChild(right);

    return row;
  }

  /**
   * Multi-Row 컨테이너 생성
   *
   * CSS Grid를 사용하여 rowSpan, colSpan을 처리합니다.
   * 셀 내용은 BodyRenderer에서 채웁니다.
   */
  private createMultiRowContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'ps-row ps-multirow-container';
    container.style.display = 'grid';
    container.style.position = 'absolute';
    container.style.left = '0';
    container.style.right = '0';

    // Grid 템플릿 설정
    if (this.multiRowTemplate) {
      const rowHeight = 36; // 기본 행 높이 (나중에 옵션으로)
      container.style.gridTemplateRows = `repeat(${this.multiRowTemplate.rowCount}, ${rowHeight}px)`;
      // gridTemplateColumns는 BodyRenderer에서 설정 (CSS 변수 사용)
    }

    return container;
  }

  /**
   * Multi-Row 템플릿 조회
   */
  getMultiRowTemplate(): RowTemplate | null {
    return this.multiRowTemplate;
  }

  /**
   * 그리드 컬럼 수 조회
   */
  getGridColumnCount(): number {
    return this.gridColumnCount;
  }
}
