/**
 * ViewDataManager - 뷰 설정 관리자
 *
 * "데이터 저장소"가 아니라 "뷰 설정 관리자"입니다.
 * 모든 데이터를 저장하는 게 아니라, 뷰 설정을 관리하고 필요한 데이터를 조합하여 제공합니다.
 *
 * 핵심 개념:
 * - 저장: mode, pinned 정보, 피봇 결과 (피봇 모드만)
 * - 저장하지 않음: scrollableRows, scrollableColumns (기존 모듈에서 참조)
 *
 * 필터/정렬 vs 피봇의 차이:
 * - 필터/정렬: Uint32Array (인덱스만 반환) → DataStore 원본 참조
 * - 피봇: 새로운 Row[] + ColumnDef[] 생성 → ViewDataManager에 저장 필요
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

import type { ColumnDef, Row as RowData } from '../types';
import type { EventEmitter } from './EventEmitter';
import type {
  ViewMode,
  PivotConfig,
  PivotResult,
  ColumnGroup,
} from './ViewConfig';
import type { GridCore } from './GridCore';

// =============================================================================
// 이벤트 타입
// =============================================================================

/**
 * ViewDataManager 이벤트 맵
 */
export interface ViewDataManagerEventMap {
  /** 모드 변경 시 */
  'mode:changed': { mode: ViewMode; previousMode: ViewMode };
  
  /** 고정 컬럼 변경 시 */
  'pinnedColumns:changed': { left: string[]; right: string[] };
  
  /** 고정 행 변경 시 */
  'pinnedRows:changed': { top: (string | number)[]; bottom: (string | number)[] };
  
  /** 피봇 결과 변경 시 */
  'pivot:changed': { result: PivotResult | null };
}

// =============================================================================
// ViewDataManager 클래스
// =============================================================================

/**
 * 뷰 설정 관리자
 *
 * 일반/피봇 모드의 뷰 설정을 중앙에서 관리합니다.
 */
export class ViewDataManager {
  // ==========================================================================
  // 저장: 뷰 설정
  // ==========================================================================

  /** 현재 뷰 모드 */
  private mode: ViewMode = 'normal';

  /** 좌측 고정 컬럼 키 */
  private pinnedLeftColumnKeys: string[] = [];

  /** 우측 고정 컬럼 키 */
  private pinnedRightColumnKeys: string[] = [];

  /** 상단 고정 행 ID */
  private pinnedTopRowIds: (string | number)[] = [];

  /** 하단 고정 행 ID */
  private pinnedBottomRowIds: (string | number)[] = [];

  // ==========================================================================
  // 저장: 피봇 결과 (피봇 모드만)
  // ==========================================================================

  /** 피봇된 행 데이터 */
  private pivotedData: RowData[] | null = null;

  /** 피봇으로 생성된 컬럼 정의 */
  private pivotedColumns: ColumnDef[] | null = null;

  /** 피봇 컬럼 그룹 */
  private pivotColumnGroups: ColumnGroup[] | null = null;

  /** 현재 피봇 설정 */
  private currentPivotConfig: PivotConfig | null = null;

  // ==========================================================================
  // 참조: 기존 모듈 (저장하지 않음)
  // ==========================================================================

  /** GridCore 참조 (DataStore + IndexManager 접근) */
  private gridCore: GridCore | null = null;

  /** 이벤트 발행기 (선택) */
  private events: EventEmitter | null = null;

  // ==========================================================================
  // 생성자
  // ==========================================================================

  /**
   * @param events - 이벤트 발행기 (선택)
   */
  constructor(events?: EventEmitter) {
    this.events = events ?? null;
  }

  // ==========================================================================
  // 초기화
  // ==========================================================================

  /**
   * GridCore 연결
   *
   * ViewDataManager는 GridCore를 통해 DataStore와 IndexManager에 접근합니다.
   */
  setGridCore(gridCore: GridCore): void {
    this.gridCore = gridCore;
  }

  /**
   * GridCore 반환
   */
  getGridCore(): GridCore | null {
    return this.gridCore;
  }

  // ==========================================================================
  // 모드 관리
  // ==========================================================================

  /**
   * 현재 뷰 모드 반환
   */
  getMode(): ViewMode {
    return this.mode;
  }

  /**
   * 일반 모드로 설정
   */
  setNormalMode(): void {
    const previousMode = this.mode;
    this.mode = 'normal';

    // 피봇 데이터 초기화
    this.clearPivotData();

    this.emitEvent('mode:changed', { mode: 'normal', previousMode });
  }

  /**
   * 피봇 모드로 설정
   *
   * 피봇 설정과 결과를 함께 받아 저장합니다.
   * rowFields는 자동으로 좌측 고정 컬럼으로 설정됩니다.
   *
   * @param config - 피봇 설정
   * @param result - 피봇 결과 (Worker에서 계산된)
   */
  setPivotMode(config: PivotConfig, result: PivotResult): void {
    const previousMode = this.mode;
    this.mode = 'pivot';

    // 피봇 설정 저장
    this.currentPivotConfig = config;

    // 피봇 결과 저장
    this.pivotedData = result.rows;
    this.pivotedColumns = result.columns;
    this.pivotColumnGroups = result.columnGroups ?? null;

    // rowFields를 자동으로 좌측 고정
    this.pinnedLeftColumnKeys = [...config.rowFields];

    this.emitEvent('mode:changed', { mode: 'pivot', previousMode });
    this.emitEvent('pivot:changed', { result });
    this.emitEvent('pinnedColumns:changed', {
      left: this.pinnedLeftColumnKeys,
      right: this.pinnedRightColumnKeys,
    });
  }

  /**
   * 피봇 데이터 초기화
   */
  private clearPivotData(): void {
    this.pivotedData = null;
    this.pivotedColumns = null;
    this.pivotColumnGroups = null;
    this.currentPivotConfig = null;

    this.emitEvent('pivot:changed', { result: null });
  }

  // ==========================================================================
  // 피봇 데이터 접근 (피봇 모드에서만 유효)
  // ==========================================================================

  /**
   * 피봇된 행 데이터 반환
   *
   * 피봇 모드에서만 유효합니다. 일반 모드에서는 null을 반환합니다.
   */
  getPivotedData(): RowData[] | null {
    return this.pivotedData;
  }

  /**
   * 피봇으로 생성된 컬럼 정의 반환
   *
   * 피봇 모드에서만 유효합니다. 일반 모드에서는 null을 반환합니다.
   */
  getPivotedColumns(): ColumnDef[] | null {
    return this.pivotedColumns;
  }

  /**
   * 피봇 컬럼 그룹 반환
   */
  getPivotColumnGroups(): ColumnGroup[] | null {
    return this.pivotColumnGroups;
  }

  /**
   * 현재 피봇 설정 반환
   */
  getCurrentPivotConfig(): PivotConfig | null {
    return this.currentPivotConfig;
  }

  // ==========================================================================
  // 컬럼 고정 관리
  // ==========================================================================

  /**
   * 좌측 고정 컬럼 키 반환
   */
  getPinnedLeftColumnKeys(): string[] {
    return [...this.pinnedLeftColumnKeys];
  }

  /**
   * 우측 고정 컬럼 키 반환
   */
  getPinnedRightColumnKeys(): string[] {
    return [...this.pinnedRightColumnKeys];
  }

  /**
   * 좌측 고정 컬럼 설정
   */
  setPinnedLeftColumnKeys(keys: string[]): void {
    this.pinnedLeftColumnKeys = [...keys];
    this.emitEvent('pinnedColumns:changed', {
      left: this.pinnedLeftColumnKeys,
      right: this.pinnedRightColumnKeys,
    });
  }

  /**
   * 우측 고정 컬럼 설정
   */
  setPinnedRightColumnKeys(keys: string[]): void {
    this.pinnedRightColumnKeys = [...keys];
    this.emitEvent('pinnedColumns:changed', {
      left: this.pinnedLeftColumnKeys,
      right: this.pinnedRightColumnKeys,
    });
  }

  /**
   * 컬럼 고정 추가
   */
  pinColumn(key: string, position: 'left' | 'right'): void {
    if (position === 'left') {
      if (!this.pinnedLeftColumnKeys.includes(key)) {
        this.pinnedLeftColumnKeys.push(key);
      }
      // 반대쪽에서 제거
      this.pinnedRightColumnKeys = this.pinnedRightColumnKeys.filter(k => k !== key);
    } else {
      if (!this.pinnedRightColumnKeys.includes(key)) {
        this.pinnedRightColumnKeys.push(key);
      }
      // 반대쪽에서 제거
      this.pinnedLeftColumnKeys = this.pinnedLeftColumnKeys.filter(k => k !== key);
    }

    this.emitEvent('pinnedColumns:changed', {
      left: this.pinnedLeftColumnKeys,
      right: this.pinnedRightColumnKeys,
    });
  }

  /**
   * 컬럼 고정 해제
   */
  unpinColumn(key: string): void {
    this.pinnedLeftColumnKeys = this.pinnedLeftColumnKeys.filter(k => k !== key);
    this.pinnedRightColumnKeys = this.pinnedRightColumnKeys.filter(k => k !== key);

    this.emitEvent('pinnedColumns:changed', {
      left: this.pinnedLeftColumnKeys,
      right: this.pinnedRightColumnKeys,
    });
  }

  // ==========================================================================
  // 행 고정 관리
  // ==========================================================================

  /**
   * 상단 고정 행 ID 반환
   */
  getPinnedTopRowIds(): (string | number)[] {
    return [...this.pinnedTopRowIds];
  }

  /**
   * 하단 고정 행 ID 반환
   */
  getPinnedBottomRowIds(): (string | number)[] {
    return [...this.pinnedBottomRowIds];
  }

  /**
   * 상단 고정 행 ID 설정
   */
  setPinnedTopRowIds(ids: (string | number)[]): void {
    this.pinnedTopRowIds = [...ids];
    this.emitEvent('pinnedRows:changed', {
      top: this.pinnedTopRowIds,
      bottom: this.pinnedBottomRowIds,
    });
  }

  /**
   * 하단 고정 행 ID 설정
   */
  setPinnedBottomRowIds(ids: (string | number)[]): void {
    this.pinnedBottomRowIds = [...ids];
    this.emitEvent('pinnedRows:changed', {
      top: this.pinnedTopRowIds,
      bottom: this.pinnedBottomRowIds,
    });
  }

  /**
   * 행 고정 추가
   */
  pinRow(id: string | number, position: 'top' | 'bottom'): void {
    if (position === 'top') {
      if (!this.pinnedTopRowIds.includes(id)) {
        this.pinnedTopRowIds.push(id);
      }
      // 반대쪽에서 제거
      this.pinnedBottomRowIds = this.pinnedBottomRowIds.filter(i => i !== id);
    } else {
      if (!this.pinnedBottomRowIds.includes(id)) {
        this.pinnedBottomRowIds.push(id);
      }
      // 반대쪽에서 제거
      this.pinnedTopRowIds = this.pinnedTopRowIds.filter(i => i !== id);
    }

    this.emitEvent('pinnedRows:changed', {
      top: this.pinnedTopRowIds,
      bottom: this.pinnedBottomRowIds,
    });
  }

  /**
   * 행 고정 해제
   */
  unpinRow(id: string | number): void {
    this.pinnedTopRowIds = this.pinnedTopRowIds.filter(i => i !== id);
    this.pinnedBottomRowIds = this.pinnedBottomRowIds.filter(i => i !== id);

    this.emitEvent('pinnedRows:changed', {
      top: this.pinnedTopRowIds,
      bottom: this.pinnedBottomRowIds,
    });
  }

  // ==========================================================================
  // 컬럼 레이아웃 계산
  // ==========================================================================

  /**
   * 컬럼 레이아웃 계산
   *
   * 피봇 모드와 일반 모드에서 각각 적절한 컬럼 소스를 사용합니다.
   */
  getColumnLayout(): {
    left: ColumnDef[];
    center: ColumnDef[];
    right: ColumnDef[];
  } {
    const allColumns = this.mode === 'pivot'
      ? this.pivotedColumns ?? []
      : this.gridCore?.getColumns() ?? [];

    const left: ColumnDef[] = [];
    const center: ColumnDef[] = [];
    const right: ColumnDef[] = [];

    for (const col of allColumns) {
      if (this.pinnedLeftColumnKeys.includes(col.key)) {
        left.push(col);
      } else if (this.pinnedRightColumnKeys.includes(col.key)) {
        right.push(col);
      } else {
        center.push(col);
      }
    }

    // 고정 컬럼 순서 유지
    left.sort((a, b) => 
      this.pinnedLeftColumnKeys.indexOf(a.key) - this.pinnedLeftColumnKeys.indexOf(b.key)
    );
    right.sort((a, b) => 
      this.pinnedRightColumnKeys.indexOf(a.key) - this.pinnedRightColumnKeys.indexOf(b.key)
    );

    return { left, center, right };
  }

  // ==========================================================================
  // 유틸리티
  // ==========================================================================

  /**
   * 피봇 모드 여부 확인
   */
  isPivotMode(): boolean {
    return this.mode === 'pivot';
  }

  /**
   * 일반 모드 여부 확인
   */
  isNormalMode(): boolean {
    return this.mode === 'normal';
  }

  /**
   * 모든 설정 초기화
   */
  reset(): void {
    const previousMode = this.mode;
    
    this.mode = 'normal';
    this.pinnedLeftColumnKeys = [];
    this.pinnedRightColumnKeys = [];
    this.pinnedTopRowIds = [];
    this.pinnedBottomRowIds = [];
    this.clearPivotData();

    if (previousMode !== 'normal') {
      this.emitEvent('mode:changed', { mode: 'normal', previousMode });
    }
  }

  // ==========================================================================
  // 이벤트 발행 (Private)
  // ==========================================================================

  /**
   * 이벤트 발행
   *
   * ViewDataManager 이벤트는 'viewDataManager:' 접두사를 붙여 발행합니다.
   * 기존 GridEventType과의 호환성을 위해 any 타입으로 캐스팅합니다.
   */
  private emitEvent<K extends keyof ViewDataManagerEventMap>(
    event: K,
    data: ViewDataManagerEventMap[K]
  ): void {
    if (this.events) {
      // ViewDataManager 이벤트는 custom event로 처리
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.events as any).emit(`viewDataManager:${event}`, data);
    }
  }
}
