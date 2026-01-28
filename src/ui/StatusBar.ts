/**
 * StatusBar - 그리드 하단 상태 표시줄
 *
 * 로딩 단계별 소요 시간, 행 수 등의 정보를 표시합니다.
 * 높이는 16px로 고정됩니다.
 */

/**
 * 성능 측정 항목
 */
export interface PerformanceTiming {
  /** 측정 항목 이름 */
  name: string;
  /** 소요 시간 (ms) */
  duration: number;
}

/**
 * 상태 표시줄 설정
 */
export interface StatusBarOptions {
  /** 표시 여부 (기본: true) */
  visible?: boolean;
}

/**
 * 상태 표시줄
 */
export class StatusBar {
  private container: HTMLElement;
  private element: HTMLElement;
  private timingContainer: HTMLElement;
  private rowCountContainer: HTMLElement;

  /** 현재 타이밍 데이터 */
  private timings: PerformanceTiming[] = [];

  /** 현재 행 수 정보 */
  private rowCount = { total: 0, visible: 0 };

  constructor(container: HTMLElement, _options: StatusBarOptions = {}) {
    this.container = container;

    // 상태 표시줄 요소 생성
    this.element = document.createElement('div');
    this.element.className = 'ps-status-bar';

    // 타이밍 정보 영역 (왼쪽)
    this.timingContainer = document.createElement('div');
    this.timingContainer.className = 'ps-status-bar__timing';
    this.element.appendChild(this.timingContainer);

    // 행 수 정보 영역 (오른쪽)
    this.rowCountContainer = document.createElement('div');
    this.rowCountContainer.className = 'ps-status-bar__row-count';
    this.element.appendChild(this.rowCountContainer);

    // 컨테이너에 추가
    this.container.appendChild(this.element);

    // 초기 렌더링
    this.render();
  }

  // ===========================================================================
  // 공개 API
  // ===========================================================================

  /**
   * 타이밍 데이터 업데이트
   */
  setTimings(timings: PerformanceTiming[]): void {
    this.timings = timings;
    this.renderTimings();
  }

  /**
   * 단일 타이밍 추가/업데이트
   */
  addTiming(name: string, duration: number): void {
    const existing = this.timings.find(t => t.name === name);
    if (existing) {
      existing.duration = duration;
    } else {
      this.timings.push({ name, duration });
    }
    this.renderTimings();
  }

  /**
   * 타이밍 초기화
   */
  clearTimings(): void {
    this.timings = [];
    this.renderTimings();
  }

  /**
   * 행 수 정보 업데이트
   */
  setRowCount(total: number, visible: number): void {
    this.rowCount = { total, visible };
    this.renderRowCount();
  }

  /**
   * 상태 표시줄 표시/숨김
   */
  setVisible(visible: boolean): void {
    this.element.style.display = visible ? '' : 'none';
  }

  /**
   * 리소스 정리
   */
  destroy(): void {
    this.element.remove();
  }

  // ===========================================================================
  // 내부 메서드
  // ===========================================================================

  private render(): void {
    this.renderTimings();
    this.renderRowCount();
  }

  private renderTimings(): void {
    if (this.timings.length === 0) {
      this.timingContainer.textContent = '';
      return;
    }

    // 타이밍을 한 줄로 표시: "Load: 45ms | Filter: 12ms | Sort: 8ms | Render: 23ms"
    const timingText = this.timings
      .map(t => `${t.name}: ${t.duration.toFixed(1)}ms`)
      .join(' | ');

    this.timingContainer.textContent = timingText;
  }

  private renderRowCount(): void {
    if (this.rowCount.total === 0) {
      this.rowCountContainer.textContent = '';
      return;
    }

    if (this.rowCount.visible === this.rowCount.total) {
      this.rowCountContainer.textContent = `${this.rowCount.total.toLocaleString()} rows`;
    } else {
      this.rowCountContainer.textContent =
        `${this.rowCount.visible.toLocaleString()} / ${this.rowCount.total.toLocaleString()} rows`;
    }
  }
}
