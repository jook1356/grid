/**
 * GridCore - Grid 라이브러리의 메인 클래스
 *
 * 모든 모듈을 통합하고 간단한 API를 제공하는 파사드(Facade) 클래스입니다.
 * React, Vue, Angular 등의 프레임워크에서 이 클래스를 사용합니다.
 *
 * 내부 모듈:
 * - EventEmitter: 이벤트 발행/구독
 * - DataStore: 원본 데이터 관리
 * - IndexManager: 인덱스 배열 관리
 * - WorkerBridge: Worker 통신
 *
 * @example
 * const grid = new GridCore({
 *   columns: [
 *     { key: 'id', type: 'number' },
 *     { key: 'name', type: 'string' },
 *   ]
 * });
 *
 * await grid.initialize();
 * await grid.loadData(data);
 *
 * // 정렬
 * await grid.sort([{ columnKey: 'name', direction: 'asc' }]);
 *
 * // 화면에 표시할 데이터 가져오기
 * const rows = grid.getRowsInRange(0, 50);
 */

import type {
  Row,
  ColumnDef,
  SortState,
  FilterState,
  ViewState,
  GridEventType,
  GridEventHandler,
  Unsubscribe,
  AggregateResult,
  AggregateQueryOptions,
} from '../types';

import { EventEmitter } from './EventEmitter';
import { DataStore } from './DataStore';
import { IndexManager } from './IndexManager';
import { WorkerBridge } from '../processor/WorkerBridge';
import { ViewDataManager } from './ViewDataManager';
import type { PivotConfig, PivotResult } from './ViewConfig';

// =============================================================================
// 타입 정의
// =============================================================================

/**
 * GridCore 생성 옵션
 */
export interface GridCoreOptions {
  /** 컬럼 정의 */
  columns: ColumnDef[];

  /** 초기 데이터 (선택) */
  data?: Row[];

  /** 행 ID 컬럼 키 (기본값: 'id') */
  idKey?: string;
}

/**
 * 뷰 범위 (가상화용)
 */
export interface ViewRange {
  /** 시작 인덱스 */
  start: number;
  /** 끝 인덱스 */
  end: number;
}

// =============================================================================
// GridCore 클래스
// =============================================================================

/**
 * Grid 라이브러리 메인 클래스
 */
export class GridCore {
  // ===========================================================================
  // 내부 모듈
  // ===========================================================================

  /** 이벤트 발행기 */
  private readonly events: EventEmitter;

  /** 원본 데이터 저장소 */
  private readonly dataStore: DataStore;

  /** 인덱스 관리자 */
  private readonly indexManager: IndexManager;

  /** Worker 통신 브릿지 */
  private readonly workerBridge: WorkerBridge;

  /** 뷰 설정 관리자 (피봇/일반 통합) */
  private readonly viewDataManager: ViewDataManager;

  // ===========================================================================
  // 상태
  // ===========================================================================

  /** 현재 뷰 상태 (정렬, 필터, 그룹) */
  private viewState: ViewState = {
    sorts: [],
    filters: [],
    groups: null,
  };

  /** 초기화 완료 여부 */
  private initialized = false;

  /** 데이터 로드 완료 여부 */
  private dataLoaded = false;

  // ===========================================================================
  // 생성자
  // ===========================================================================

  /**
   * @param options - 생성 옵션
   */
  constructor(private readonly options: GridCoreOptions) {
    // 모듈 생성
    this.events = new EventEmitter();
    this.dataStore = new DataStore(this.events, { idKey: options.idKey });
    this.indexManager = new IndexManager(this.events);
    this.workerBridge = new WorkerBridge(this.events);
    this.viewDataManager = new ViewDataManager(this.events);

    // ViewDataManager에 GridCore 연결
    this.viewDataManager.setGridCore(this);

    // 초기 컬럼 설정
    this.dataStore.setColumns(options.columns);
  }

  // ===========================================================================
  // 초기화
  // ===========================================================================

  /**
   * Grid 초기화
   *
   * Worker를 생성하고 준비합니다.
   * 데이터 로드 전에 반드시 호출해야 합니다.
   *
   * @example
   * const grid = new GridCore({ columns });
   * await grid.initialize();
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Worker 초기화
    await this.workerBridge.initialize();

    this.initialized = true;

    // 초기 데이터가 있으면 로드
    if (this.options.data && this.options.data.length > 0) {
      await this.loadData(this.options.data);
    }
  }

  /**
   * 초기화 여부 확인
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('GridCore not initialized. Call initialize() first.');
    }
  }

  // ===========================================================================
  // 데이터 로드
  // ===========================================================================

  /**
   * 데이터 로드
   *
   * @param data - 로드할 데이터 배열
   * @param columns - 컬럼 정의 (선택, 변경 시에만)
   *
   * @example
   * await grid.loadData([
   *   { id: 1, name: '홍길동', age: 25 },
   *   { id: 2, name: '김철수', age: 30 },
   * ]);
   */
  async loadData(data: Row[], columns?: ColumnDef[]): Promise<void> {
    this.ensureInitialized();

    // 컬럼 업데이트 (있으면)
    if (columns) {
      this.dataStore.setColumns(columns);
    }

    // DataStore에 저장
    this.dataStore.setData(data, this.dataStore.getColumns() as ColumnDef[]);

    // IndexManager 초기화
    this.indexManager.initialize(data.length);

    // Worker에 데이터 전송
    await this.workerBridge.initializeData(data);

    // 뷰 상태 리셋
    this.viewState = {
      sorts: [],
      filters: [],
      groups: null,
    };

    this.dataLoaded = true;
  }

  /**
   * 데이터 로드 여부 확인
   */
  private ensureDataLoaded(): void {
    if (!this.dataLoaded) {
      throw new Error('No data loaded. Call loadData() first.');
    }
  }

  // ===========================================================================
  // 정렬
  // ===========================================================================

  /**
   * 정렬 적용
   *
   * @param sorts - 정렬 조건 배열 (다중 정렬 지원)
   *
   * @example
   * // 단일 정렬
   * await grid.sort([{ columnKey: 'name', direction: 'asc' }]);
   *
   * // 다중 정렬 (이름 오름차순 → 나이 내림차순)
   * await grid.sort([
   *   { columnKey: 'name', direction: 'asc' },
   *   { columnKey: 'age', direction: 'desc' }
   * ]);
   *
   * // 정렬 해제
   * await grid.sort([]);
   */
  async sort(sorts: SortState[]): Promise<void> {
    this.ensureInitialized();
    this.ensureDataLoaded();

    // 뷰 상태 업데이트
    this.viewState.sorts = sorts;

    // 이벤트 발행
    this.events.emit('view:changed', {
      viewState: this.viewState,
      changedProperty: 'sorts',
    });

    // Worker에서 처리
    const result = await this.workerBridge.query({
      sorts,
      filters: this.viewState.filters,
    });

    // 결과 적용
    this.indexManager.applyProcessorResult(result);
  }

  /**
   * 정렬 토글
   *
   * 컬럼을 클릭했을 때 사용: 없음 → 오름차순 → 내림차순 → 없음
   *
   * @param columnKey - 컬럼 키
   * @param multiSort - 다중 정렬 모드 (Shift+클릭)
   *
   * @example
   * // 단일 정렬 토글
   * await grid.toggleSort('name');
   *
   * // 다중 정렬에 추가
   * await grid.toggleSort('age', true);
   */
  async toggleSort(columnKey: string, multiSort = false): Promise<void> {
    const currentSorts = [...this.viewState.sorts];
    const existingIndex = currentSorts.findIndex((s) => s.columnKey === columnKey);

    if (existingIndex >= 0) {
      const existing = currentSorts[existingIndex];
      if (existing?.direction === 'asc') {
        // 오름차순 → 내림차순
        currentSorts[existingIndex] = { columnKey, direction: 'desc' };
      } else {
        // 내림차순 → 제거
        currentSorts.splice(existingIndex, 1);
      }
    } else {
      // 없음 → 오름차순 추가
      if (multiSort) {
        currentSorts.push({ columnKey, direction: 'asc' });
      } else {
        // 단일 정렬 모드면 기존 정렬 제거
        currentSorts.length = 0;
        currentSorts.push({ columnKey, direction: 'asc' });
      }
    }

    await this.sort(currentSorts);
  }

  // ===========================================================================
  // 필터
  // ===========================================================================

  /**
   * 필터 적용
   *
   * @param filters - 필터 조건 배열 (AND 조합)
   *
   * @example
   * await grid.filter([
   *   { columnKey: 'age', operator: 'gte', value: 20 },
   *   { columnKey: 'name', operator: 'contains', value: '김' }
   * ]);
   *
   * // 필터 해제
   * await grid.filter([]);
   */
  async filter(filters: FilterState[]): Promise<void> {
    this.ensureInitialized();
    this.ensureDataLoaded();

    // 뷰 상태 업데이트
    this.viewState.filters = filters;

    // 이벤트 발행
    this.events.emit('view:changed', {
      viewState: this.viewState,
      changedProperty: 'filters',
    });

    // Worker에서 처리
    const result = await this.workerBridge.query({
      sorts: this.viewState.sorts,
      filters,
    });

    // 결과 적용
    this.indexManager.applyProcessorResult(result);
  }

  /**
   * 필터 추가/업데이트
   *
   * @param filter - 필터 조건
   */
  async addFilter(filter: FilterState): Promise<void> {
    const filters = [...this.viewState.filters];
    const existingIndex = filters.findIndex((f) => f.columnKey === filter.columnKey);

    if (existingIndex >= 0) {
      filters[existingIndex] = filter;
    } else {
      filters.push(filter);
    }

    await this.filter(filters);
  }

  /**
   * 필터 제거
   *
   * @param columnKey - 제거할 컬럼 키
   */
  async removeFilter(columnKey: string): Promise<void> {
    const filters = this.viewState.filters.filter((f) => f.columnKey !== columnKey);
    await this.filter(filters);
  }

  /**
   * 모든 필터 해제
   */
  async clearFilters(): Promise<void> {
    await this.filter([]);
  }

  // ===========================================================================
  // 집계
  // ===========================================================================

  /**
   * 집계 수행
   *
   * @param options - 집계 옵션
   * @returns 집계 결과
   *
   * @example
   * const result = await grid.aggregate({
   *   groupBy: ['department'],
   *   aggregates: [
   *     { columnKey: 'salary', function: 'avg' },
   *     { columnKey: 'age', function: 'max' }
   *   ]
   * });
   */
  async aggregate(options: AggregateQueryOptions): Promise<AggregateResult[]> {
    this.ensureInitialized();
    this.ensureDataLoaded();

    return this.workerBridge.aggregate(options);
  }

  // ===========================================================================
  // 피봇
  // ===========================================================================

  /**
   * 피봇 모드 설정
   *
   * 데이터를 피봇하여 행↔열 변환을 수행합니다.
   * rowFields는 자동으로 좌측 고정 컬럼이 됩니다.
   *
   * @param config - 피봇 설정
   * @returns 피봇 결과
   *
   * @example
   * const result = await grid.setPivotConfig({
   *   rowFields: ['department'],
   *   columnFields: ['year', 'quarter'],
   *   valueFields: [{ field: 'sales', aggregate: 'sum' }]
   * });
   *
   * // result.rows: 피봇된 데이터
   * // result.columns: 동적 생성된 컬럼 (rowFields + 동적 값 컬럼)
   */
  async setPivotConfig(config: PivotConfig): Promise<PivotResult> {
    this.ensureInitialized();
    this.ensureDataLoaded();

    // 현재 필터 적용
    const pivotOptions = {
      rowFields: config.rowFields,
      columnFields: config.columnFields,
      valueFields: config.valueFields.map(vf => ({
        field: vf.field,
        aggregate: vf.aggregate,
        label: vf.label,
      })),
      filters: this.viewState.filters,
    };

    // Worker에서 피봇 실행
    const result = await this.workerBridge.pivot(pivotOptions);

    // ViewDataManager에 피봇 모드 설정 (자동 컬럼 고정 포함)
    this.viewDataManager.setPivotMode(config, result);

    // 이벤트 발행
    this.events.emit('view:changed', {
      viewState: this.viewState,
      changedProperty: 'pivot',
    });

    return result;
  }

  /**
   * 피봇 모드 해제 (일반 모드로 복귀)
   *
   * @example
   * grid.clearPivot();
   */
  clearPivot(): void {
    this.viewDataManager.setNormalMode();

    // 이벤트 발행
    this.events.emit('view:changed', {
      viewState: this.viewState,
      changedProperty: 'pivot',
    });
  }

  /**
   * 피봇 모드 여부 확인
   */
  isPivotMode(): boolean {
    return this.viewDataManager.isPivotMode();
  }

  /**
   * 현재 피봇 설정 가져오기
   */
  getPivotConfig(): PivotConfig | null {
    return this.viewDataManager.getCurrentPivotConfig();
  }

  /**
   * 피봇된 데이터 가져오기 (피봇 모드에서만 유효)
   */
  getPivotedData(): Row[] | null {
    return this.viewDataManager.getPivotedData();
  }

  /**
   * 피봇된 컬럼 정의 가져오기 (피봇 모드에서만 유효)
   */
  getPivotedColumns(): ColumnDef[] | null {
    return this.viewDataManager.getPivotedColumns();
  }

  // ===========================================================================
  // 데이터 접근
  // ===========================================================================

  /**
   * 범위 내 행 가져오기 (가상화용)
   *
   * @param start - 시작 인덱스 (가시 인덱스)
   * @param end - 끝 인덱스 (가시 인덱스, 미포함)
   * @returns 해당 범위의 행 배열
   *
   * @example
   * // 화면에 보이는 0~50번 행 가져오기
   * const rows = grid.getRowsInRange(0, 50);
   */
  getRowsInRange(start: number, end: number): Row[] {
    const indices = this.indexManager.getIndicesInRange(start, end);
    return this.dataStore.getRowsByIndices(indices);
  }

  /**
   * 가시 인덱스로 행 가져오기
   *
   * @param visibleIndex - 가시 인덱스
   * @returns 해당 행 또는 undefined
   */
  getRowByVisibleIndex(visibleIndex: number): Row | undefined {
    const originalIndex = this.indexManager.toOriginalIndex(visibleIndex);
    if (originalIndex < 0) return undefined;
    return this.dataStore.getRowByIndex(originalIndex);
  }

  /**
   * ID로 행 가져오기
   *
   * @param id - 행 ID
   * @returns 해당 행 또는 undefined
   */
  getRowById(id: string | number): Row | undefined {
    return this.dataStore.getRowById(id);
  }

  /**
   * 전체 데이터 가져오기 (읽기 전용)
   */
  getAllData(): readonly Row[] {
    return this.dataStore.getData();
  }

  /**
   * 컬럼 정의 가져오기 (읽기 전용)
   */
  getColumns(): readonly ColumnDef[] {
    return this.dataStore.getColumns();
  }

  // ===========================================================================
  // CRUD 작업
  // ===========================================================================

  /**
   * 행 추가
   *
   * @param row - 추가할 행
   *
   * @example
   * await grid.addRow({ id: 100, name: '새 사람', age: 25 });
   */
  async addRow(row: Row): Promise<void> {
    this.dataStore.addRow(row);

    // Worker 데이터 재초기화 (TODO: 증분 업데이트 최적화)
    await this.workerBridge.initializeData(this.dataStore.getData() as Row[]);
    this.indexManager.initialize(this.dataStore.getRowCount());

    // 현재 정렬/필터 다시 적용
    if (this.viewState.sorts.length > 0 || this.viewState.filters.length > 0) {
      const result = await this.workerBridge.query({
        sorts: this.viewState.sorts,
        filters: this.viewState.filters,
      });
      this.indexManager.applyProcessorResult(result);
    }
  }

  /**
   * 행 수정
   *
   * @param index - 원본 인덱스
   * @param updates - 수정할 필드
   */
  async updateRow(index: number, updates: Partial<Row>): Promise<void> {
    this.dataStore.patchRow(index, updates);

    // Worker 데이터 재초기화
    await this.workerBridge.initializeData(this.dataStore.getData() as Row[]);

    // 현재 정렬/필터 다시 적용
    if (this.viewState.sorts.length > 0 || this.viewState.filters.length > 0) {
      const result = await this.workerBridge.query({
        sorts: this.viewState.sorts,
        filters: this.viewState.filters,
      });
      this.indexManager.applyProcessorResult(result);
    }
  }

  /**
   * 행 삭제
   *
   * @param index - 원본 인덱스
   */
  async removeRow(index: number): Promise<void> {
    this.dataStore.removeRow(index);

    // Worker 데이터 재초기화
    await this.workerBridge.initializeData(this.dataStore.getData() as Row[]);
    this.indexManager.initialize(this.dataStore.getRowCount());

    // 현재 정렬/필터 다시 적용
    if (this.viewState.sorts.length > 0 || this.viewState.filters.length > 0) {
      const result = await this.workerBridge.query({
        sorts: this.viewState.sorts,
        filters: this.viewState.filters,
      });
      this.indexManager.applyProcessorResult(result);
    }
  }

  // ===========================================================================
  // 상태 조회
  // ===========================================================================

  /**
   * 현재 뷰 상태 가져오기
   */
  getViewState(): Readonly<ViewState> {
    return this.viewState;
  }

  /**
   * 전체 행 수
   */
  getTotalRowCount(): number {
    return this.indexManager.getTotalCount();
  }

  /**
   * 현재 보이는 행 수 (필터 적용 후)
   */
  getVisibleRowCount(): number {
    return this.indexManager.getVisibleCount();
  }

  /**
   * 필터링된 행 수
   */
  getFilteredOutCount(): number {
    return this.indexManager.getFilteredOutCount();
  }

  // ===========================================================================
  // 이벤트
  // ===========================================================================

  /**
   * 이벤트 구독
   *
   * @param type - 이벤트 타입
   * @param handler - 핸들러 함수
   * @returns 구독 해제 함수
   *
   * @example
   * const unsubscribe = grid.on('indices:updated', (event) => {
   *   console.log(`${event.payload.visibleCount}행 표시`);
   *   setRows(grid.getRowsInRange(0, 50));
   * });
   *
   * // 나중에
   * unsubscribe();
   */
  on<T extends GridEventType>(
    type: T,
    handler: GridEventHandler<T>
  ): Unsubscribe {
    return this.events.on(type, handler);
  }

  /**
   * 이벤트 구독 해제
   */
  off<T extends GridEventType>(
    type: T,
    handler: GridEventHandler<T>
  ): void {
    this.events.off(type, handler);
  }

  /**
   * 한 번만 실행되는 이벤트 구독
   */
  once<T extends GridEventType>(
    type: T,
    handler: GridEventHandler<T>
  ): Unsubscribe {
    return this.events.once(type, handler);
  }

  // ===========================================================================
  // 정리
  // ===========================================================================

  /**
   * 리소스 정리
   *
   * 컴포넌트 언마운트 시 반드시 호출하세요.
   *
   * @example
   * // React
   * useEffect(() => {
   *   return () => grid.destroy();
   * }, []);
   *
   * // Vue
   * onUnmounted(() => grid.destroy());
   */
  destroy(): void {
    this.workerBridge.destroy();
    this.indexManager.destroy();
    this.events.destroy();
    this.initialized = false;
    this.dataLoaded = false;
  }

  // ===========================================================================
  // 내부 모듈 접근 (고급 사용자용)
  // ===========================================================================

  /**
   * EventEmitter 접근
   * @internal
   */
  get _events(): EventEmitter {
    return this.events;
  }

  /**
   * DataStore 접근
   * @internal
   */
  get _dataStore(): DataStore {
    return this.dataStore;
  }

  /**
   * IndexManager 접근
   * @internal
   */
  get _indexManager(): IndexManager {
    return this.indexManager;
  }

  /**
   * WorkerBridge 접근
   * @internal
   */
  get _workerBridge(): WorkerBridge {
    return this.workerBridge;
  }

  /**
   * ViewDataManager 접근
   *
   * 뷰 설정 관리자로, 피봇/일반 모드 전환 및 고정 컬럼/행 관리에 사용됩니다.
   *
   * @example
   * // 피봇 모드 설정
   * grid.viewManager.setPivotMode(config, result);
   *
   * // 컬럼 고정
   * grid.viewManager.pinColumn('name', 'left');
   */
  get viewManager(): ViewDataManager {
    return this.viewDataManager;
  }
}
