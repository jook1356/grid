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
 * - ArqueroProcessor: 데이터 처리 (정렬/필터/집계)
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
  IDataProcessor,
  ApiConfig,
  PivotConfig,
  PivotResult,
} from '../types';

import { EventEmitter } from './EventEmitter';
import { DataStore } from './DataStore';
import { IndexManager } from './IndexManager';
import { RowCache } from './RowCache';
import { createProcessor, type ProcessorOptions } from '../processor/ProcessorFactory';
import { WorkerProcessor, type StatsCallback } from '../processor/WorkerProcessor';
import type { EngineType } from '../processor/engines/IEngine';

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

  /** API 설정 (데이터 페칭) */
  api?: ApiConfig;

  /** 행 ID 컬럼 키 (기본값: 'id') */
  idKey?: string;

  /**
   * 데이터 처리 엔진 (021-engine-abstraction-architecture)
   * - 'aq': Arquero (기본값) - 필터/정렬 위주, 번들 사이즈 민감
   * - 'db': DuckDB-Wasm - 복잡 집계 반복, 서버가 Arrow 제공
   * @default 'aq'
   */
  engine?: EngineType;

  /**
   * Web Worker 사용 여부
   * - false (기본값): 메인 스레드에서 실행
   * - true: Web Worker에서 실행 (UI 블로킹 방지)
   * @default false
   */
  useWorker?: boolean;
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

  /** 데이터 처리기 (정렬/필터/집계) */
  private readonly processor: IDataProcessor;

  /** 행 캐시 (Worker 가상 데이터 로딩용) */
  private readonly rowCache: RowCache;

  /** Worker 사용 여부 */
  private readonly useWorker: boolean;

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

  /** 프리페치 관련 상태 */
  private prefetchState = {
    /** 마지막 스크롤 위치 */
    lastStartIndex: 0,
    /** 현재 진행 중인 프리페치 Promise */
    pendingPrefetch: null as Promise<void> | null,
    /** 프리페치 debounce 타이머 */
    debounceTimer: null as ReturnType<typeof setTimeout> | null,
  };

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

    // 프로세서 생성 (engine, useWorker 옵션 지원)
    this.useWorker = options.useWorker ?? false;
    const processorOptions: ProcessorOptions = {
      engine: options.engine ?? 'aq',
      useWorker: this.useWorker,
    };
    this.processor = createProcessor(processorOptions);

    // 행 캐시 생성 (Worker 가상 데이터 로딩용)
    this.rowCache = new RowCache({
      maxRows: 500,
      bufferMultiplier: 2,
    });

    // 초기 컬럼 설정
    this.dataStore.setColumns(options.columns);
  }

  // ===========================================================================
  // 초기화
  // ===========================================================================

  /**
   * Grid 초기화
   *
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

    this.initialized = true;

    // 초기 데이터가 있으면 로드
    if (this.options.data && this.options.data.length > 0) {
      await this.loadData(this.options.data);
    } else if (this.options.api) {
      // API 설정이 있으면 워커에서 페칭
      // (WorkerProcessor인 경우에만 워커에서 페칭 가능, 아니면 에러 또는 메인 스레드 페칭 고려)
      if (this.useWorker && this.processor instanceof WorkerProcessor) {
        await this.processor.fetchData(this.options.api);
        this.dataLoaded = true;
        this.indexManager.initialize(this.processor.getRowCount());
        this.rowCache.clear();
      } else {
        // TODO: 메인 스레드 모드에서도 api 페칭 지원할지 결정 필요
        console.warn('API fetching is currently only supported in Worker mode.');
      }
    }
  }

  /** 초기화 여부 확인 */
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

    // 프로세서에 데이터 로드
    await this.processor.initialize(data);

    // 뷰 상태 리셋
    this.viewState = {
      sorts: [],
      filters: [],
      groups: null,
    };

    // 캐시 무효화 (Worker 가상 데이터 로딩)
    this.rowCache.clear();

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

    // 프로세서에서 처리
    const result = await this.processor.query({
      sorts,
      filters: this.viewState.filters,
    });

    // 결과 적용
    this.indexManager.applyProcessorResult(result);

    // 캐시 무효화 (Worker 가상 데이터 로딩)
    this.rowCache.invalidate();
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

    // 프로세서에서 처리
    const result = await this.processor.query({
      sorts: this.viewState.sorts,
      filters,
    });

    // 결과 적용
    this.indexManager.applyProcessorResult(result);

    // 캐시 무효화 (Worker 가상 데이터 로딩)
    this.rowCache.invalidate();
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

    return this.processor.aggregate(options);
  }

  // ===========================================================================
  // 피벗
  // ===========================================================================

  /**
   * 피벗 수행
   * 
   * @param config - 피벗 설정
   */
  async pivot(config: PivotConfig): Promise<PivotResult> {
    this.ensureInitialized();
    this.ensureDataLoaded();

    // 피벗 설정 변경 시 이전 캐시 무효화 (이전 피벗 결과가 반환되는 것을 방지)
    this.rowCache.clear();

    if (this.useWorker && this.processor instanceof WorkerProcessor) {
      return this.processor.pivot(config);
    }

    // Main Thread 모드에서는 외부(PureSheet)에서 PivotProcessor를 직접 사용하거나
    // 여기서 InternalProcessor를 통해 처리할 수 있음.
    // 현재 구조상 PureSheet가 로컬 PivotProcessor를 가지고 있으므로,
    // 여기서는 Worker 모드가 아닐 경우 에러를 던지거나 null을 반환하여 
    // 호출자가 처리하도록 할 수 있음. 
    // 하지만 일관성을 위해 여기서 처리하는 것이 좋음.
    // 다만 Processor 인터페이스에 pivot이 없으므로(WorkerProcessor에만 추가함),
    // 타입 캐스팅이나 구조 변경이 필요.

    // 임시로 WorkerProcessor가 아닌 경우 에러
    throw new Error('GridCore.pivot is currently only supported in Worker mode.');
  }

  // ===========================================================================
  // 데이터 접근
  // ===========================================================================

  /**
   * 범위 내 행 가져오기 (가상화용, 동기)
   *
   * Main Thread 모드에서 사용합니다.
   * Worker 모드에서는 getVisibleRowsAsync()를 사용하세요.
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
   * 범위 내 행 가져오기 (가상화용, 비동기)
   *
   * Worker 모드에서 캐시를 활용하여 보이는 행만 가져옵니다.
   * Main Thread 모드에서도 사용 가능 (동일한 인터페이스 제공).
   *
   * @param start - 시작 인덱스 (가시 인덱스)
   * @param end - 끝 인덱스 (가시 인덱스, 미포함)
   * @returns 해당 범위의 Row 배열
   *
   * @example
   * // Worker 모드에서 화면에 보이는 0~50번 행 가져오기
   * const rows = await grid.getVisibleRowsAsync(0, 50);
   */
  async getVisibleRowsAsync(start: number, end: number): Promise<Row[]> {
    // Worker 모드가 아니면 동기 방식으로 처리
    if (!this.useWorker) {
      return this.getRowsInRange(start, end);
    }

    // 1. 캐시 확인
    const cacheResult = this.rowCache.getRange(start, end);

    // 캐시에 모든 행이 있으면 바로 반환
    if (cacheResult.complete) {
      return cacheResult.rows as Row[];
    }

    // 2. 누락된 범위 계산 (연속된 범위로 병합)
    const missingRanges = this.mergeToRanges(cacheResult.missingIndices);

    // 3. Worker에서 누락된 행 가져오기
    const fetchPromises = missingRanges.map(([s, e]) =>
      this.processor.fetchVisibleRows(s, e)
    );
    const fetchedRowsArrays = await Promise.all(fetchPromises);

    // 4. 캐시 업데이트
    for (let i = 0; i < missingRanges.length; i++) {
      const [rangeStart] = missingRanges[i]!;
      const rows = fetchedRowsArrays[i]!;
      this.rowCache.setRange(rangeStart, rows);
    }

    // 5. 완성된 행 배열 반환
    const finalResult = this.rowCache.getRange(start, end);
    return finalResult.rows.filter((row): row is Row => row !== null);
  }

  /**
   * 누락된 인덱스들을 연속된 범위로 병합
   *
   * @param indices - 누락된 인덱스 배열
   * @returns 범위 배열 [[start, end], ...]
   */
  private mergeToRanges(indices: number[]): [number, number][] {
    if (indices.length === 0) return [];

    const sorted = [...indices].sort((a, b) => a - b);
    const ranges: [number, number][] = [];

    let rangeStart = sorted[0]!;
    let rangeEnd = sorted[0]!;

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === rangeEnd + 1) {
        rangeEnd = sorted[i]!;
      } else {
        ranges.push([rangeStart, rangeEnd + 1]);
        rangeStart = sorted[i]!;
        rangeEnd = sorted[i]!;
      }
    }
    ranges.push([rangeStart, rangeEnd + 1]);

    return ranges;
  }

  // ==========================================================================
  // 프리페치 최적화
  // ==========================================================================

  /**
   * 스크롤 방향 기반 프리페치
   *
   * 현재 보이는 범위 기준으로 스크롤 방향을 감지하고,
   * 해당 방향으로 데이터를 미리 로드합니다.
   *
   * @param visibleStart - 현재 보이는 시작 인덱스
   * @param visibleEnd - 현재 보이는 끝 인덱스
   * @param prefetchSize - 프리페치할 행 수 (기본: 보이는 행 수의 2배)
   */
  async prefetchForScroll(
    visibleStart: number,
    visibleEnd: number,
    prefetchSize?: number
  ): Promise<void> {
    // Worker 모드가 아니면 불필요
    if (!this.useWorker) return;

    const visibleCount = visibleEnd - visibleStart;
    const size = prefetchSize ?? visibleCount * 2;

    // 스크롤 방향 감지
    const scrollDirection = visibleStart > this.prefetchState.lastStartIndex ? 'down' : 'up';
    this.prefetchState.lastStartIndex = visibleStart;

    const totalRows = this.processor.getVisibleRowCount();

    // 프리페치 범위 계산
    let prefetchStart: number;
    let prefetchEnd: number;

    if (scrollDirection === 'down') {
      // 아래로 스크롤: 아래쪽 미리 로드
      prefetchStart = visibleEnd;
      prefetchEnd = Math.min(visibleEnd + size, totalRows);
    } else {
      // 위로 스크롤: 위쪽 미리 로드
      prefetchStart = Math.max(0, visibleStart - size);
      prefetchEnd = visibleStart;
    }

    // 범위가 유효하지 않으면 스킵
    if (prefetchStart >= prefetchEnd) return;

    // 캐시에 없는 행만 프리페치
    const cacheResult = this.rowCache.getRange(prefetchStart, prefetchEnd);
    if (cacheResult.complete) return;

    // Worker에서 가져오기 (결과는 캐시에 저장됨)
    await this.getVisibleRowsAsync(prefetchStart, prefetchEnd);
  }

  /**
   * Debounced 프리페치
   *
   * 빠른 스크롤 시 요청이 너무 많이 발생하는 것을 방지합니다.
   *
   * @param visibleStart - 현재 보이는 시작 인덱스
   * @param visibleEnd - 현재 보이는 끝 인덱스
   * @param delay - Debounce 지연 시간 (기본: 100ms)
   */
  prefetchDebounced(
    visibleStart: number,
    visibleEnd: number,
    delay = 100
  ): void {
    // 이전 타이머 취소
    if (this.prefetchState.debounceTimer) {
      clearTimeout(this.prefetchState.debounceTimer);
    }

    // 새 타이머 설정
    this.prefetchState.debounceTimer = setTimeout(() => {
      this.prefetchState.debounceTimer = null;
      void this.prefetchForScroll(visibleStart, visibleEnd);
    }, delay);
  }

  /**
   * 캐시 범위 외 데이터 정리
   *
   * 현재 보이는 범위에서 먼 캐시 데이터를 정리합니다.
   * 메모리 사용량을 최적화합니다.
   *
   * @param visibleStart - 현재 보이는 시작 인덱스
   * @param visibleEnd - 현재 보이는 끝 인덱스
   */
  evictDistantCache(visibleStart: number, visibleEnd: number): void {
    this.rowCache.evictOutsideRange(visibleStart, visibleEnd);
  }

  /**
   * 가시 인덱스로 행 가져오기
   *
   * @param visibleIndex - 가시 인덱스
   * @returns 해당 행 또는 undefined
   */
  getRowByVisibleIndex(visibleIndex: number): Row | undefined {
    // Worker 모드면 캐시에서 조회
    if (this.useWorker) {
      return this.rowCache.get(visibleIndex) ?? undefined;
    }

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
   * 
   * 필터/정렬이 적용되지 않은 전체 데이터를 반환합니다.
   */
  getAllData(): readonly Row[] {
    return this.dataStore.getData();
  }

  /**
   * 보이는 데이터 가져오기 (필터/정렬 적용 후)
   * 
   * IndexManager의 visibleIndices를 기반으로 필터/정렬된 데이터를 반환합니다.
   */
  getVisibleData(): Row[] {
    const allData = this.dataStore.getData();
    const visibleIndices = this.indexManager.getVisibleIndices();
    return Array.from(visibleIndices).map(i => allData[i]).filter((row): row is Row => row !== undefined);
  }

  /**
   * 컬럼 정의 가져오기 (읽기 전용)
   */
  getColumns(): readonly ColumnDef[] {
    return this.dataStore.getColumns();
  }

  /**
   * 컬럼 정의 설정
   * 
   * 피벗 모드 전환 등에서 컬럼을 동적으로 변경할 때 사용합니다.
   * 
   * @param columns - 새 컬럼 정의
   */
  setColumns(columns: ColumnDef[]): void {
    this.dataStore.setColumns(columns);
  }

  /**
   * DataStore 접근 (피벗 모드 등에서 직접 데이터 조작 시 사용)
   */
  getDataStore(): DataStore {
    return this.dataStore;
  }

  /**
   * IndexManager 접근 (피벗 모드 등에서 인덱스 재설정 시 사용)
   */
  /**
   * IndexManager 접근 (피벗 모드 등에서 인덱스 재설정 시 사용)
   */
  getIndexManager(): IndexManager {
    return this.indexManager;
  }

  /**
   * 프로세서 통계 콜백 설정 (Worker 성능 측정용)
   */
  setProcessorStatsCallback(callback: StatsCallback): void {
    if (this.processor instanceof WorkerProcessor) {
      this.processor.setStatsCallback(callback);
    }
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

    // 프로세서 데이터 재초기화 (TODO: 증분 업데이트 최적화)
    await this.processor.initialize(this.dataStore.getData() as Row[]);
    this.indexManager.initialize(this.dataStore.getRowCount());

    // 현재 정렬/필터 다시 적용
    if (this.viewState.sorts.length > 0 || this.viewState.filters.length > 0) {
      const result = await this.processor.query({
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

    // 프로세서 데이터 재초기화
    await this.processor.initialize(this.dataStore.getData() as Row[]);

    // 현재 정렬/필터 다시 적용
    if (this.viewState.sorts.length > 0 || this.viewState.filters.length > 0) {
      const result = await this.processor.query({
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

    // 프로세서 데이터 재초기화
    await this.processor.initialize(this.dataStore.getData() as Row[]);
    this.indexManager.initialize(this.dataStore.getRowCount());

    // 현재 정렬/필터 다시 적용
    if (this.viewState.sorts.length > 0 || this.viewState.filters.length > 0) {
      const result = await this.processor.query({
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
   * 프로세서 인스턴스 가져오기
   *
   * 피벗 모드에서 필터/정렬된 인덱스를 직접 계산할 때 사용합니다.
   */
  getProcessor(): IDataProcessor {
    return this.processor;
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

  /**
   * Worker 사용 여부
   *
   * Worker 모드면 getVisibleRowsAsync()를 사용해야 합니다.
   */
  isUsingWorker(): boolean {
    return this.useWorker;
  }

  /**
   * 행 캐시 상태 (디버그용)
   */
  getCacheStats(): ReturnType<RowCache['getStats']> {
    return this.rowCache.getStats();
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
    // 프리페치 타이머 정리
    if (this.prefetchState.debounceTimer) {
      clearTimeout(this.prefetchState.debounceTimer);
      this.prefetchState.debounceTimer = null;
    }

    this.processor.destroy();
    this.indexManager.destroy();
    this.rowCache.clear();
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
   * 데이터 프로세서 접근
   * @internal
   */
  get _processor(): IDataProcessor {
    return this.processor;
  }
}
