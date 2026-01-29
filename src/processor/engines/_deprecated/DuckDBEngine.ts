/**
 * DuckDBEngine - DuckDB-Wasm 기반 데이터 처리 엔진
 *
 * IEngine 인터페이스를 구현한 DuckDB 엔진입니다.
 * SQL 기반 쿼리와 GROUPING SETS를 사용한 효율적인 집계를 지원합니다.
 *
 * DuckDB-Wasm이란?
 * - 고성능 분석 데이터베이스 DuckDB의 WebAssembly 버전
 * - SQL 쿼리 지원
 * - Arrow IPC 직접 로드 가능
 * - 복잡한 집계 연산에 최적화
 *
 * 권장 사용 케이스:
 * - 복잡한 집계 반복 (피벗, 그룹화 등)
 * - 서버가 Arrow 형식으로 데이터 제공
 * - 100만 건 이상의 대용량 데이터
 *
 * 주의사항:
 * - 번들 사이즈가 큼 (~3.5MB)
 * - 초기화 시간이 필요함
 * - 사용하지 않으면 Tree-shaking으로 제외됨
 */

import type { IEngine } from './IEngine';
import type { Row, CellValue, ColumnDef } from '../../types/data.types';
import type { SortState, FilterState } from '../../types/state.types';
import type {
  ProcessorResult,
  AggregateQueryOptions,
  AggregateResult,
} from '../../types/processor.types';
import type {
  PivotConfig,
  PivotResult,
  PivotHeaderNode,
  PivotRow,
  RowMergeInfo,
  PivotValueField,
} from '../../types/pivot.types';
import {
  createPivotColumnKey,
  PIVOT_KEY_SUBTOTAL,
  PIVOT_KEY_GRANDTOTAL,
  PIVOT_LABEL_SUBTOTAL,
  PIVOT_LABEL_GRANDTOTAL,
} from '../../types/pivot.types';

// DuckDB-Wasm 타입 (동적 임포트를 위한 인터페이스)
interface AsyncDuckDB {
  open(config: any): Promise<void>;
  connect(): Promise<AsyncDuckDBConnection>;
  terminate(): Promise<void>;
}

interface AsyncDuckDBConnection {
  query<T = any>(sql: string): Promise<{ toArray(): T[] }>;
  insertArrowFromIPCStream(data: Uint8Array, options?: { name?: string }): Promise<void>;
  close(): Promise<void>;
}


/**
 * DuckDB-Wasm 기반 데이터 처리 엔진
 */
export class DuckDBEngine implements IEngine {
  /** DuckDB 인스턴스 */
  private db: AsyncDuckDB | null = null;

  /** DuckDB 연결 */
  private conn: AsyncDuckDBConnection | null = null;

  /** 원본 행 수 */
  private rowCount: number = 0;

  /** 컬럼 키 목록 */
  private columnKeys: string[] = [];

  /** 초기화 완료 여부 */
  private initialized: boolean = false;

  // ==========================================================================
  // 데이터 로드
  // ==========================================================================

  async loadData(data: Row[]): Promise<void> {
    if (data.length === 0) {
      this.rowCount = 0;
      this.columnKeys = [];
      return;
    }

    // DuckDB 초기화
    if (!this.initialized) {
      await this.initDuckDB();
    }

    this.rowCount = data.length;

    // 컬럼 키 추출
    const firstRow = data[0];
    if (firstRow) {
      this.columnKeys = Object.keys(firstRow).filter((k) => k !== '__rowIndex__');
    }

    // 데이터를 SQL INSERT로 로드
    // 행 인덱스 추가
    const dataWithIndex = data.map((row, idx) => ({
      ...row,
      __rowIndex__: idx,
    }));

    // 테이블 생성 및 데이터 삽입
    await this.createTableFromData(dataWithIndex);
  }

  async loadArrowIPC(ipcBytes: Uint8Array): Promise<void> {
    if (!this.initialized) {
      await this.initDuckDB();
    }

    if (!this.conn) {
      throw new Error('DuckDB connection not available');
    }

    // Arrow IPC 직접 로드
    await this.conn.insertArrowFromIPCStream(ipcBytes, { name: 'data' });

    // 행 수 조회
    const result = await this.conn.query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM data');
    const rows = result.toArray();
    this.rowCount = rows[0]?.cnt ?? 0;

    // 컬럼 정보 조회
    const schema = await this.conn.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'data'"
    );
    this.columnKeys = schema.toArray().map((r) => r.column_name);
  }

  // ==========================================================================
  // 기본 연산
  // ==========================================================================

  async filter(filters: FilterState[]): Promise<ProcessorResult> {
    this.ensureInitialized();

    const whereClause = this.buildWhereClause(filters);
    const sql = `SELECT __rowIndex__ FROM data ${whereClause} ORDER BY __rowIndex__`;

    const result = await this.conn!.query<{ __rowIndex__: number }>(sql);
    const rows = result.toArray();

    return {
      indices: new Uint32Array(rows.map((r) => r.__rowIndex__)),
      totalCount: this.rowCount,
      filteredCount: rows.length,
    };
  }

  async sort(sorts: SortState[]): Promise<ProcessorResult> {
    this.ensureInitialized();

    const orderByClause = this.buildOrderByClause(sorts);
    const sql = `SELECT __rowIndex__ FROM data ${orderByClause}`;

    const result = await this.conn!.query<{ __rowIndex__: number }>(sql);
    const rows = result.toArray();

    return {
      indices: new Uint32Array(rows.map((r) => r.__rowIndex__)),
      totalCount: this.rowCount,
      filteredCount: rows.length,
    };
  }

  async query(options: { filters?: FilterState[]; sorts?: SortState[] }): Promise<ProcessorResult> {
    this.ensureInitialized();

    const whereClause = options.filters ? this.buildWhereClause(options.filters) : '';
    const orderByClause = options.sorts ? this.buildOrderByClause(options.sorts) : '';

    const sql = `SELECT __rowIndex__ FROM data ${whereClause} ${orderByClause}`;

    const result = await this.conn!.query<{ __rowIndex__: number }>(sql);
    const rows = result.toArray();

    return {
      indices: new Uint32Array(rows.map((r) => r.__rowIndex__)),
      totalCount: this.rowCount,
      filteredCount: rows.length,
    };
  }

  // ==========================================================================
  // 집계
  // ==========================================================================

  async aggregate(options: AggregateQueryOptions): Promise<AggregateResult[]> {
    this.ensureInitialized();

    const whereClause = options.filters ? this.buildWhereClause(options.filters) : '';

    // SELECT 절 생성
    const groupByFields = options.groupBy.map((f) => this.escapeIdentifier(f)).join(', ');
    const selectFields = options.groupBy.map((f) => this.escapeIdentifier(f)).join(', ');

    const aggFields = options.aggregates
      .map((agg) => {
        const alias = agg.alias || `${agg.function}_${agg.columnKey}`;
        return `${this.buildAggFunction(agg.function, agg.columnKey)} AS ${this.escapeIdentifier(alias)}`;
      })
      .join(', ');

    const sql = `
      SELECT ${selectFields}, COUNT(*) as count, ${aggFields}
      FROM data
      ${whereClause}
      GROUP BY ${groupByFields}
    `;

    const result = await this.conn!.query(sql);
    const rows = result.toArray();

    return rows.map((row: any) => {
      const groupValues: Record<string, CellValue> = {};
      for (const key of options.groupBy) {
        groupValues[key] = row[key];
      }

      const groupKey = options.groupBy.map((key) => String(row[key])).join('|');

      const aggregates: Record<string, CellValue> = {};
      for (const agg of options.aggregates) {
        const alias = agg.alias || `${agg.function}_${agg.columnKey}`;
        aggregates[alias] = row[alias];
      }

      return {
        groupKey,
        groupValues,
        aggregates,
        count: row.count,
      };
    });
  }

  // ==========================================================================
  // 피벗 (GROUPING SETS 활용)
  // ==========================================================================

  async pivot(config: PivotConfig): Promise<PivotResult> {
    this.ensureInitialized();

    // 필드 키 배열 추출
    const columnFieldKeys = config.columnFields.map(f => f.field);
    const rowFieldKeys = config.rowFields.map(f => f.field);

    // 1단계: 필터 적용
    const whereClause = config.filters ? this.buildWhereClause(config.filters) : '';

    // 2단계: 유니크 값 추출
    const uniqueValues = await this.extractUniqueValues(columnFieldKeys, config.sorts, whereClause);

    // 3단계: GROUPING SETS를 사용한 집계
    const aggregationMap = await this.aggregateWithGroupingSets(config, whereClause);

    // 4단계: 리프 데이터 조회
    const leafRows = await this.getLeafRows(config, whereClause);

    // 5단계: 컬럼 헤더 트리 빌드
    const columnHeaderTree = this.buildHeaderTree(uniqueValues, config);

    // 6단계: 피벗 데이터 구조 변환
    const pivotedData = this.transformToPivotStructure(
      leafRows,
      aggregationMap,
      config,
      uniqueValues
    );

    // 7단계: 행 병합 정보 계산
    const rowMergeInfo = this.calculateRowMergeInfo(pivotedData, rowFieldKeys);

    // 8단계: 컬럼 정의 생성
    const { columns, rowHeaderColumns } = this.generateColumnDefs(columnHeaderTree, config);

    // 9단계: 헤더 레벨 수 계산
    const headerLevelCount = columnFieldKeys.length + (config.valueFields.length > 1 ? 1 : 0);


    return {
      columnHeaderTree,
      headerLevelCount,
      rowMergeInfo,
      pivotedData,
      columns,
      rowHeaderColumns,
      meta: {
        totalRows: pivotedData.length,
        totalColumns: columns.length,
        uniqueValues: Object.fromEntries(
          Object.entries(uniqueValues).map(([k, v]) => [k, v.length])
        ),
      },
    };
  }

  // ==========================================================================
  // 데이터 조회
  // ==========================================================================

  async getRows(indices: number[]): Promise<Row[]> {
    this.ensureInitialized();

    if (indices.length === 0) return [];

    const indicesList = indices.join(',');
    const sql = `SELECT * FROM data WHERE __rowIndex__ IN (${indicesList})`;

    const result = await this.conn!.query(sql);
    const rows = result.toArray() as Row[];

    // __rowIndex__ 제거
    return rows.map((row) => {
      const { __rowIndex__, ...rest } = row as any;
      return rest as Row;
    });
  }

  async getAllRows(): Promise<Row[]> {
    if (!this.conn) return [];

    const sql = 'SELECT * FROM data ORDER BY __rowIndex__';
    const result = await this.conn.query(sql);
    const rows = result.toArray() as Row[];

    return rows.map((row) => {
      const { __rowIndex__, ...rest } = row as any;
      return rest as Row;
    });
  }

  async getUniqueValues(columnKey: string): Promise<CellValue[]> {
    this.ensureInitialized();

    const sql = `SELECT DISTINCT ${this.escapeIdentifier(columnKey)} FROM data`;
    const result = await this.conn!.query(sql);
    const rows = result.toArray();

    return rows.map((r: any) => r[columnKey]);
  }

  // ==========================================================================
  // 메타데이터
  // ==========================================================================

  getRowCount(): number {
    return this.rowCount;
  }

  getColumnKeys(): string[] {
    return this.columnKeys;
  }

  // ==========================================================================
  // 정리
  // ==========================================================================

  async cleanup(): Promise<void> {
    if (this.conn) {
      await this.conn.close();
      this.conn = null;
    }
    if (this.db) {
      await this.db.terminate();
      this.db = null;
    }
    this.rowCount = 0;
    this.columnKeys = [];
    this.initialized = false;
  }

  // ==========================================================================
  // 내부 헬퍼
  // ==========================================================================

  /** DuckDB 초기화 */
  private async initDuckDB(): Promise<void> {
    // 동적 임포트 (Tree-shaking 지원)
    const duckdb = await import('@duckdb/duckdb-wasm');

    // 번들 선택 (CDN에서 로드)
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

    // Worker URL 생성 (importScripts 사용)
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker!}");`], { type: 'text/javascript' })
    );

    // Worker 생성
    const worker = new Worker(workerUrl);

    // 로거 생성
    const logger = new duckdb.ConsoleLogger();

    // DB 인스턴스 생성
    this.db = new duckdb.AsyncDuckDB(logger, worker) as unknown as AsyncDuckDB;

    // WASM 모듈 인스턴스화
    await (this.db as any).instantiate(bundle.mainModule, bundle.pthreadWorker);

    // Worker URL 정리
    URL.revokeObjectURL(workerUrl);

    // 연결 생성
    this.conn = await this.db.connect() as unknown as AsyncDuckDBConnection;
    this.initialized = true;
  }

  /** 초기화 확인 */
  private ensureInitialized(): void {
    if (!this.conn) {
      throw new Error('DuckDBEngine not initialized. Call loadData() first.');
    }
  }

  /** 데이터로 테이블 생성 */
  private async createTableFromData(data: Row[]): Promise<void> {
    if (!this.conn || data.length === 0) return;

    // 기존 테이블 삭제
    await this.conn.query('DROP TABLE IF EXISTS data');

    // 컬럼 타입 추론
    const firstRow = data[0]!;
    const columnDefs = Object.entries(firstRow)
      .map(([key, value]) => {
        const sqlType = this.inferSQLType(value);
        return `${this.escapeIdentifier(key)} ${sqlType}`;
      })
      .join(', ');

    // 테이블 생성
    await this.conn.query(`CREATE TABLE data (${columnDefs})`);

    // 데이터 삽입 (배치)
    const batchSize = 1000;
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      const values = batch
        .map((row) => {
          const vals = Object.values(row).map((v) => this.escapeSQLValue(v));
          return `(${vals.join(', ')})`;
        })
        .join(', ');

      const columns = Object.keys(firstRow)
        .map((k) => this.escapeIdentifier(k))
        .join(', ');
      await this.conn.query(`INSERT INTO data (${columns}) VALUES ${values}`);
    }
  }

  /** SQL 타입 추론 */
  private inferSQLType(value: unknown): string {
    if (value === null || value === undefined) return 'VARCHAR';
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'BIGINT' : 'DOUBLE';
    }
    if (typeof value === 'boolean') return 'BOOLEAN';
    if (value instanceof Date) return 'TIMESTAMP';
    return 'VARCHAR';
  }

  /** SQL 값 이스케이프 */
  private escapeSQLValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (value instanceof Date) return `'${value.toISOString()}'`;
    // 문자열 이스케이프
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  /** 식별자 이스케이프 */
  private escapeIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  /** WHERE 절 생성 */
  private buildWhereClause(filters: FilterState[]): string {
    if (filters.length === 0) return '';

    const conditions = filters.map((filter) => {
      const col = this.escapeIdentifier(filter.columnKey);
      const val = this.escapeSQLValue(filter.value);
      const val2 = filter.value2 !== undefined ? this.escapeSQLValue(filter.value2) : '';

      switch (filter.operator) {
        case 'eq':
          return `${col} = ${val}`;
        case 'neq':
          return `${col} != ${val}`;
        case 'gt':
          return `${col} > ${val}`;
        case 'gte':
          return `${col} >= ${val}`;
        case 'lt':
          return `${col} < ${val}`;
        case 'lte':
          return `${col} <= ${val}`;
        case 'contains':
          return `LOWER(${col}) LIKE '%${String(filter.value).toLowerCase().replace(/'/g, "''")}%'`;
        case 'notContains':
          return `LOWER(${col}) NOT LIKE '%${String(filter.value).toLowerCase().replace(/'/g, "''")}%'`;
        case 'startsWith':
          return `LOWER(${col}) LIKE '${String(filter.value).toLowerCase().replace(/'/g, "''")}%'`;
        case 'endsWith':
          return `LOWER(${col}) LIKE '%${String(filter.value).toLowerCase().replace(/'/g, "''")}'`;
        case 'between':
          return `${col} BETWEEN ${val} AND ${val2}`;
        case 'isNull':
          return `${col} IS NULL`;
        case 'isNotNull':
          return `${col} IS NOT NULL`;
        default:
          return '1=1';
      }
    });

    return `WHERE ${conditions.join(' AND ')}`;
  }

  /** ORDER BY 절 생성 */
  private buildOrderByClause(sorts: SortState[]): string {
    if (sorts.length === 0) return '';

    const orderBy = sorts
      .map((sort) => {
        const col = this.escapeIdentifier(sort.columnKey);
        const dir = sort.direction === 'desc' ? 'DESC' : 'ASC';
        return `${col} ${dir}`;
      })
      .join(', ');

    return `ORDER BY ${orderBy}`;
  }

  /** 집계 함수 SQL 생성 */
  private buildAggFunction(func: string, columnKey: string): string {
    const col = this.escapeIdentifier(columnKey);
    switch (func) {
      case 'sum':
        return `SUM(${col})`;
      case 'avg':
        return `AVG(${col})`;
      case 'min':
        return `MIN(${col})`;
      case 'max':
        return `MAX(${col})`;
      case 'count':
        return 'COUNT(*)';
      case 'first':
        return `FIRST(${col})`;
      case 'last':
        return `LAST(${col})`;
      default:
        return `SUM(${col})`;
    }
  }

  /** 유니크 값 추출 */
  private async extractUniqueValues(
    columnFields: string[],
    sorts?: SortState[],
    whereClause: string = ''
  ): Promise<Record<string, CellValue[]>> {
    const result: Record<string, CellValue[]> = {};

    for (const field of columnFields) {
      const sortConfig = sorts?.find((s) => s.columnKey === field);
      const direction = sortConfig?.direction === 'desc' ? 'DESC' : 'ASC';

      const sql = `
        SELECT DISTINCT ${this.escapeIdentifier(field)} as val
        FROM data
        ${whereClause}
        ORDER BY val ${direction}
      `;

      const queryResult = await this.conn!.query<{ val: CellValue }>(sql);
      result[field] = queryResult.toArray().map((r) => r.val);
    }

    return result;
  }

  /** GROUPING SETS를 사용한 집계 */
  private async aggregateWithGroupingSets(
    config: PivotConfig,
    whereClause: string
  ): Promise<Map<string, number>> {
    const {
      rowFields: rowFieldDefs,
      columnFields: columnFieldDefs,
      valueFields,
      showRowSubTotals,
      showColumnSubTotals,
      showRowGrandTotals,
      showColumnGrandTotals,
    } = config;

    // 객체 배열에서 필드 키 배열 추출
    const rowFields = rowFieldDefs.map(f => f.field);
    const columnFields = columnFieldDefs.map(f => f.field);

    const aggregationMap = new Map<string, number>();

    // GROUPING SETS 생성
    const groupingSets: string[] = [];

    // 1. Leaf level
    const leafSet = [...rowFields, ...columnFields].map((f) => this.escapeIdentifier(f)).join(', ');
    groupingSets.push(`(${leafSet})`);

    // 2. Row Subtotals
    if (showRowSubTotals) {
      for (let i = 0; i < rowFields.length - 1; i++) {
        const prefix = rowFields.slice(0, i + 1);
        const set = [...prefix, ...columnFields].map((f) => this.escapeIdentifier(f)).join(', ');
        groupingSets.push(`(${set})`);
      }
    }

    // 3. Row GrandTotal
    if (showRowGrandTotals) {
      const set = columnFields.map((f) => this.escapeIdentifier(f)).join(', ');
      groupingSets.push(set ? `(${set})` : '()');
    }

    // 4. Column Subtotals
    if (showColumnSubTotals) {
      for (let i = 0; i < columnFields.length - 1; i++) {
        const prefix = columnFields.slice(0, i + 1);
        const set = [...rowFields, ...prefix].map((f) => this.escapeIdentifier(f)).join(', ');
        groupingSets.push(`(${set})`);
      }
    }

    // 5. Column GrandTotal
    if (showColumnGrandTotals) {
      const set = rowFields.map((f) => this.escapeIdentifier(f)).join(', ');
      groupingSets.push(set ? `(${set})` : '()');
    }

    // 6. Cross combinations
    if (showRowSubTotals && showColumnSubTotals) {
      for (let r = 0; r < rowFields.length - 1; r++) {
        for (let c = 0; c < columnFields.length - 1; c++) {
          const rPrefix = rowFields.slice(0, r + 1);
          const cPrefix = columnFields.slice(0, c + 1);
          const set = [...rPrefix, ...cPrefix].map((f) => this.escapeIdentifier(f)).join(', ');
          groupingSets.push(`(${set})`);
        }
      }
    }

    // 7. Row Subtotal x Col GrandTotal
    if (showRowSubTotals && showColumnGrandTotals) {
      for (let r = 0; r < rowFields.length - 1; r++) {
        const rPrefix = rowFields.slice(0, r + 1);
        const set = rPrefix.map((f) => this.escapeIdentifier(f)).join(', ');
        groupingSets.push(`(${set})`);
      }
    }

    // 8. Row GrandTotal x Col Subtotal
    if (showRowGrandTotals && showColumnSubTotals) {
      for (let c = 0; c < columnFields.length - 1; c++) {
        const cPrefix = columnFields.slice(0, c + 1);
        const set = cPrefix.map((f) => this.escapeIdentifier(f)).join(', ');
        groupingSets.push(`(${set})`);
      }
    }

    // 9. Grand Total
    if (showRowGrandTotals && showColumnGrandTotals) {
      groupingSets.push('()');
    }

    // 중복 제거
    const uniqueSets = [...new Set(groupingSets)];

    // SELECT 절
    const allFields = [...rowFields, ...columnFields];
    const selectFields = allFields.map((f) => this.escapeIdentifier(f)).join(', ');

    const aggFields = valueFields
      .map((vf) => `${this.buildAggFunction(vf.aggregate, vf.field)} AS ${this.escapeIdentifier(vf.field)}`)
      .join(', ');

    const sql = `
      SELECT ${selectFields ? selectFields + ',' : ''} ${aggFields}
      FROM data
      ${whereClause}
      GROUP BY GROUPING SETS (${uniqueSets.join(', ')})
    `;

    const result = await this.conn!.query(sql);
    const rows = result.toArray();

    // 결과를 Map에 저장
    for (const row of rows as any[]) {
      const rKey =
        rowFields.length > 0
          ? rowFields.map((f) => (row[f] !== null ? String(row[f]) : '')).join('|') ||
          PIVOT_KEY_GRANDTOTAL
          : PIVOT_KEY_GRANDTOTAL;

      const cKey =
        columnFields.length > 0
          ? columnFields.map((f) => (row[f] !== null ? String(row[f]) : '')).join('|') ||
          PIVOT_KEY_GRANDTOTAL
          : PIVOT_KEY_GRANDTOTAL;

      for (const vf of valueFields) {
        const val = row[vf.field];
        if (typeof val === 'number') {
          const mapKey = `${rKey}::${cKey}::${vf.field}`;
          aggregationMap.set(mapKey, val);
        }
      }
    }

    return aggregationMap;
  }

  /** 리프 데이터 조회 */
  private async getLeafRows(
    config: PivotConfig,
    whereClause: string
  ): Promise<Record<string, unknown>[]> {
    const { rowFields: rowFieldDefs, columnFields: columnFieldDefs, valueFields, sorts } = config;

    // 객체 배열에서 필드 키 배열 추출
    const rowFields = rowFieldDefs.map(f => f.field);
    const columnFields = columnFieldDefs.map(f => f.field);

    const allFields = [...rowFields, ...columnFields];
    const selectFields = allFields.map((f) => this.escapeIdentifier(f)).join(', ');

    const aggFields = valueFields
      .map((vf) => `${this.buildAggFunction(vf.aggregate, vf.field)} AS ${this.escapeIdentifier(vf.field)}`)
      .join(', ');

    const orderByClause = sorts ? this.buildOrderByClause(sorts) : '';

    const sql = `
      SELECT ${selectFields}, ${aggFields}
      FROM data
      ${whereClause}
      GROUP BY ${selectFields}
      ${orderByClause}
    `;

    const result = await this.conn!.query(sql);
    return result.toArray() as Record<string, unknown>[];
  }

  // ==========================================================================
  // 피벗 관련 헬퍼 (ArqueroEngine과 공통 로직)
  // ==========================================================================

  /** 컬럼 헤더 트리 빌드 */
  private buildHeaderTree(
    uniqueValues: Record<string, CellValue[]>,
    config: PivotConfig
  ): PivotHeaderNode {
    const {
      columnFields: columnFieldDefs,
      valueFields,
      showColumnSubTotals,
      columnSubTotalFields,
      showColumnGrandTotals,
    } = config;

    // 객체 배열에서 필드 키 배열 추출
    const columnFields = columnFieldDefs.map(f => f.field);

    const subtotalFields: string[] = [];
    if (showColumnSubTotals && columnFields.length > 0) {
      if (columnSubTotalFields && columnSubTotalFields.length > 0) {
        for (const field of columnFields) {
          if (columnSubTotalFields.includes(field)) {
            subtotalFields.push(field);
          }
        }
      } else {
        subtotalFields.push(...columnFields.slice(0, -1));
      }
    }

    const root: PivotHeaderNode = {
      value: '__root__',
      label: '',
      level: -1,
      colspan: 0,
      children: [],
      isLeaf: false,
      path: [],
    };

    const maxLevel = columnFields.length + (valueFields.length > 1 ? 1 : 0);

    this.buildTreeRecursive(root, columnFields, uniqueValues, valueFields, 0, [], subtotalFields, maxLevel);

    if (showColumnGrandTotals) {
      this.addGrandTotalColumns(root, valueFields, columnFields.length);
    }

    this.calculateColspan(root);

    return root;
  }

  private buildTreeRecursive(
    parent: PivotHeaderNode,
    columnFields: string[],
    uniqueValues: Record<string, CellValue[]>,
    valueFields: PivotValueField[],
    level: number,
    path: string[],
    subtotalFields: string[],
    maxLevel: number
  ): void {
    if (level >= columnFields.length) {
      if (valueFields.length === 1) {
        parent.columnKey = createPivotColumnKey(path, valueFields[0]!.field);
        parent.isLeaf = true;
        return;
      }

      for (const valueField of valueFields) {
        const leafNode: PivotHeaderNode = {
          value: valueField.field,
          label: valueField.header || valueField.field,
          level,
          colspan: 1,
          children: [],
          isLeaf: true,
          columnKey: createPivotColumnKey(path, valueField.field),
          path: [...path, valueField.field],
        };
        parent.children.push(leafNode);
      }
      return;
    }

    const currentField = columnFields[level];
    if (!currentField) return;

    const values = uniqueValues[currentField] || [];
    const shouldAddSubtotal = subtotalFields.includes(currentField);

    for (const value of values) {
      const strValue = String(value ?? '');
      const node: PivotHeaderNode = {
        value: strValue,
        label: strValue,
        level,
        colspan: 0,
        children: [],
        isLeaf: false,
        path: [...path, strValue],
      };

      parent.children.push(node);

      this.buildTreeRecursive(
        node,
        columnFields,
        uniqueValues,
        valueFields,
        level + 1,
        [...path, strValue],
        subtotalFields,
        maxLevel
      );

      if (shouldAddSubtotal) {
        this.addSubtotalColumn(node, valueFields, level + 1, [...path, strValue], maxLevel);
      }
    }
  }

  private addSubtotalColumn(
    parent: PivotHeaderNode,
    valueFields: PivotValueField[],
    level: number,
    path: string[],
    maxLevel: number
  ): void {
    const subtotalPath = [...path, PIVOT_KEY_SUBTOTAL];

    const subtotalNode: PivotHeaderNode = {
      value: PIVOT_KEY_SUBTOTAL,
      label: PIVOT_LABEL_SUBTOTAL,
      level,
      colspan: 0,
      children: [],
      isLeaf: false,
      path: subtotalPath,
    };

    parent.children.push(subtotalNode);
    this.fillSubtotalChildren(subtotalNode, valueFields, level + 1, subtotalPath, maxLevel);
  }

  private fillSubtotalChildren(
    parent: PivotHeaderNode,
    valueFields: PivotValueField[],
    level: number,
    path: string[],
    maxLevel: number
  ): void {
    const isValueFieldLevel = valueFields.length > 1 && level === maxLevel - 1;
    const isSingleValueLeaf = valueFields.length === 1 && level === maxLevel;

    if (isSingleValueLeaf) {
      parent.columnKey = createPivotColumnKey(path, valueFields[0]!.field);
      parent.isLeaf = true;
      return;
    }

    if (isValueFieldLevel) {
      for (const valueField of valueFields) {
        const leafNode: PivotHeaderNode = {
          value: valueField.field,
          label: valueField.header || valueField.field,
          level,
          colspan: 1,
          children: [],
          isLeaf: true,
          columnKey: createPivotColumnKey(path, valueField.field),
          path: [...path, valueField.field],
        };
        parent.children.push(leafNode);
      }
      return;
    }

    if (level < maxLevel) {
      const emptyNode: PivotHeaderNode = {
        value: '',
        label: '',
        level,
        colspan: 0,
        children: [],
        isLeaf: false,
        path: path,
      };
      parent.children.push(emptyNode);
      this.fillSubtotalChildren(emptyNode, valueFields, level + 1, path, maxLevel);
    }
  }

  private addGrandTotalColumns(
    root: PivotHeaderNode,
    valueFields: PivotValueField[],
    columnFieldCount: number
  ): void {
    const grandTotalPath = [PIVOT_KEY_GRANDTOTAL];

    const grandTotalNode: PivotHeaderNode = {
      value: PIVOT_KEY_GRANDTOTAL,
      label: PIVOT_LABEL_GRANDTOTAL,
      level: 0,
      colspan: 0,
      children: [],
      isLeaf: false,
      path: grandTotalPath,
    };

    if (valueFields.length === 1) {
      grandTotalNode.columnKey = createPivotColumnKey(grandTotalPath, valueFields[0]!.field);
      grandTotalNode.isLeaf = true;
    } else {
      for (const valueField of valueFields) {
        const leafNode: PivotHeaderNode = {
          value: valueField.field,
          label: valueField.header || valueField.field,
          level: columnFieldCount,
          colspan: 1,
          children: [],
          isLeaf: true,
          columnKey: createPivotColumnKey(grandTotalPath, valueField.field),
          path: [...grandTotalPath, valueField.field],
        };
        grandTotalNode.children.push(leafNode);
      }
    }

    root.children.push(grandTotalNode);
  }

  private calculateColspan(node: PivotHeaderNode): number {
    if (node.isLeaf || node.children.length === 0) {
      node.colspan = 1;
      return 1;
    }

    let totalColspan = 0;
    for (const child of node.children) {
      totalColspan += this.calculateColspan(child);
    }
    node.colspan = totalColspan;
    return totalColspan;
  }

  private transformToPivotStructure(
    leafRows: Record<string, unknown>[],
    aggregationMap: Map<string, number>,
    config: PivotConfig,
    uniqueValues: Record<string, CellValue[]>
  ): PivotRow[] {
    const { rowFields: rowFieldDefs, showRowSubTotals, showRowGrandTotals } = config;

    // 객체 배열에서 필드 키 배열 추출
    const rowFields = rowFieldDefs.map(f => f.field);

    const rowGroups = new Map<string, Record<string, CellValue>>();

    for (const row of leafRows) {
      const rowKey = rowFields.map((f) => String(row[f] ?? '')).join('|');

      if (!rowGroups.has(rowKey)) {
        const rowHeaderData: Record<string, CellValue> = {};
        for (const f of rowFields) {
          rowHeaderData[f] = row[f] as CellValue;
        }
        rowGroups.set(rowKey, rowHeaderData);
      }
    }

    const dataRows: PivotRow[] = [];
    const allColumnKeys = this.getAllColumnKeys(config, uniqueValues);

    const fillValues = (
      rowHeaders: Record<string, CellValue>,
      targetValues: Record<string, CellValue>
    ) => {
      const rKey = rowFields.map((f) => String(rowHeaders[f] ?? '')).join('|');

      for (const colDef of allColumnKeys) {
        const mapKey = `${rKey}::${colDef.colKey}::${colDef.valueField}`;
        const val = aggregationMap.get(mapKey);
        if (val !== undefined) {
          targetValues[colDef.fullKey] = val;
        }
      }
    };

    for (const [, rowHeaders] of rowGroups) {
      const pivotRow: PivotRow = {
        rowHeaders: { ...rowHeaders },
        values: {},
        type: 'data',
      };

      fillValues(rowHeaders, pivotRow.values);
      dataRows.push(pivotRow);
    }

    // 정렬
    dataRows.sort((a, b) => {
      for (const field of rowFields) {
        const aVal = a.rowHeaders[field];
        const bVal = b.rowHeaders[field];
        if (aVal === bVal) continue;
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return aVal - bVal;
        }
        return String(aVal).localeCompare(String(bVal));
      }
      return 0;
    });

    const result: PivotRow[] = [];

    const subtotalFields: string[] = [];
    if (showRowSubTotals && rowFields.length > 0) {
      if (config.rowSubTotalFields && config.rowSubTotalFields.length > 0) {
        for (const field of rowFields) {
          if (config.rowSubTotalFields.includes(field)) {
            subtotalFields.push(field);
          }
        }
      } else {
        subtotalFields.push(...rowFields.slice(0, -1));
      }
    }

    if (subtotalFields.length > 0) {
      this.insertMultiLevelSubtotals(
        dataRows,
        result,
        config,
        subtotalFields,
        aggregationMap,
        allColumnKeys
      );
    } else {
      result.push(...dataRows);
    }

    if (showRowGrandTotals) {
      const grandTotalRow = this.createGrandTotalRow(aggregationMap, allColumnKeys, rowFields);
      result.push(grandTotalRow);
    }

    return result;
  }

  private getAllColumnKeys(
    config: PivotConfig,
    uniqueValues: Record<string, CellValue[]>
  ): { fullKey: string; colKey: string; valueField: string }[] {
    const {
      columnFields: columnFieldDefs,
      valueFields,
      showColumnSubTotals,
      columnSubTotalFields,
      showColumnGrandTotals,
    } = config;
    const columnFields = columnFieldDefs.map(f => f.field);
    const keys: { fullKey: string; colKey: string; valueField: string }[] = [];

    const buildKeys = (level: number, currentPath: string[]) => {
      if (level >= columnFields.length) {
        for (const vf of valueFields) {
          keys.push({
            fullKey: createPivotColumnKey(currentPath, vf.field),
            colKey: currentPath.map(String).join('|'),
            valueField: vf.field,
          });
        }
        return;
      }

      const colField = columnFields[level];
      if (!colField) return;

      const values = uniqueValues[colField] || [];

      for (const val of values) {
        const strVal = String(val ?? '');
        const nextPath = [...currentPath, strVal];

        buildKeys(level + 1, nextPath);

        const needSubtotal =
          showColumnSubTotals &&
          (!columnSubTotalFields ||
            columnSubTotalFields.length === 0 ||
            columnSubTotalFields.includes(colField));

        if (needSubtotal && level < columnFields.length - 1) {
          const subPath = [...nextPath, PIVOT_KEY_SUBTOTAL];
          for (const vf of valueFields) {
            keys.push({
              fullKey: createPivotColumnKey(subPath, vf.field),
              colKey: nextPath.map(String).join('|'),
              valueField: vf.field,
            });
          }
        }
      }
    };

    buildKeys(0, []);

    if (showColumnGrandTotals) {
      const grandTotalPath = [PIVOT_KEY_GRANDTOTAL];
      for (const vf of valueFields) {
        keys.push({
          fullKey: createPivotColumnKey(grandTotalPath, vf.field),
          colKey: PIVOT_KEY_GRANDTOTAL,
          valueField: vf.field,
        });
      }
    }

    return keys;
  }

  private insertMultiLevelSubtotals(
    dataRows: PivotRow[],
    result: PivotRow[],
    config: PivotConfig,
    subtotalFields: string[],
    aggregationMap: Map<string, number>,
    allColumnKeys: { fullKey: string; colKey: string; valueField: string }[]
  ): void {
    const rowFields = config.rowFields.map(f => f.field);
    const prevValues: Record<number, CellValue> = {};
    let initialized = false;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i]!;

      if (!initialized) {
        for (let l = 0; l < rowFields.length; l++) {
          const field = rowFields[l]!;
          prevValues[l] = row.rowHeaders[field];
        }
        initialized = true;
        result.push(row);
        continue;
      }

      let changeLevel = -1;
      for (let l = 0; l < rowFields.length; l++) {
        const field = rowFields[l]!;
        const val = row.rowHeaders[field];
        if (prevValues[l] !== val) {
          changeLevel = l;
          break;
        }
      }

      if (changeLevel !== -1) {
        for (let idx = subtotalFields.length - 1; idx >= 0; idx--) {
          const field = subtotalFields[idx]!;
          const levelIndex = rowFields.indexOf(field);

          if (levelIndex >= changeLevel) {
            const groupHeaders: Record<string, CellValue> = {};
            for (let k = 0; k <= levelIndex; k++) {
              const f = rowFields[k]!;
              groupHeaders[f] = prevValues[k];
            }

            const subtotalRow = this.createSubtotalRow(
              groupHeaders,
              rowFields,
              levelIndex,
              aggregationMap,
              allColumnKeys
            );
            result.push(subtotalRow);
          }
        }
      }

      result.push(row);

      for (let l = 0; l < rowFields.length; l++) {
        const field = rowFields[l]!;
        prevValues[l] = row.rowHeaders[field];
      }
    }

    if (initialized) {
      for (let idx = subtotalFields.length - 1; idx >= 0; idx--) {
        const field = subtotalFields[idx]!;
        const levelIndex = rowFields.indexOf(field);

        const groupHeaders: Record<string, CellValue> = {};
        for (let k = 0; k <= levelIndex; k++) {
          const f = rowFields[k]!;
          groupHeaders[f] = prevValues[k];
        }

        const subtotalRow = this.createSubtotalRow(
          groupHeaders,
          rowFields,
          levelIndex,
          aggregationMap,
          allColumnKeys
        );
        result.push(subtotalRow);
      }
    }
  }

  private createSubtotalRow(
    groupHeaders: Record<string, CellValue>,
    rowFields: string[],
    levelIndex: number,
    aggregationMap: Map<string, number>,
    allColumnKeys: { fullKey: string; colKey: string; valueField: string }[]
  ): PivotRow {
    const activeFields = rowFields.slice(0, levelIndex + 1);
    const rKey = activeFields.map((f) => String(groupHeaders[f] ?? '')).join('|');

    const rowHeaders: Record<string, CellValue> = { ...groupHeaders };
    if (levelIndex < rowFields.length - 1) {
      const nextField = rowFields[levelIndex + 1];
      if (nextField) {
        rowHeaders[nextField] = PIVOT_LABEL_SUBTOTAL;
      }
    }
    for (let i = levelIndex + 2; i < rowFields.length; i++) {
      const field = rowFields[i];
      if (field) {
        rowHeaders[field] = '';
      }
    }

    const subtotalRow: PivotRow = {
      rowHeaders,
      values: {},
      type: 'subtotal',
      depth: levelIndex,
    };

    for (const colDef of allColumnKeys) {
      const mapKey = `${rKey}::${colDef.colKey}::${colDef.valueField}`;
      const val = aggregationMap.get(mapKey);
      if (val !== undefined) {
        subtotalRow.values[colDef.fullKey] = val;
      }
    }

    return subtotalRow;
  }

  private createGrandTotalRow(
    aggregationMap: Map<string, number>,
    allColumnKeys: { fullKey: string; colKey: string; valueField: string }[],
    rowFields: string[]
  ): PivotRow {
    const grandTotalRow: PivotRow = {
      rowHeaders: {},
      values: {},
      type: 'grandtotal',
    };

    const rKey = PIVOT_KEY_GRANDTOTAL;

    if (rowFields.length > 0) {
      grandTotalRow.rowHeaders[rowFields[0]!] = PIVOT_LABEL_GRANDTOTAL;
      for (let i = 1; i < rowFields.length; i++) {
        grandTotalRow.rowHeaders[rowFields[i]!] = '';
      }
    }

    for (const colDef of allColumnKeys) {
      const mapKey = `${rKey}::${colDef.colKey}::${colDef.valueField}`;
      const val = aggregationMap.get(mapKey);
      if (val !== undefined) {
        grandTotalRow.values[colDef.fullKey] = val;
      }
    }

    return grandTotalRow;
  }

  private calculateRowMergeInfo(
    rows: PivotRow[],
    rowFields: string[]
  ): Record<string, RowMergeInfo[]> {
    const mergeInfo: Record<string, RowMergeInfo[]> = {};
    if (rows.length === 0 || rowFields.length === 0) {
      return mergeInfo;
    }

    for (const field of rowFields) {
      mergeInfo[field] = [];
    }

    const tracking: Record<string, { value: CellValue; startIndex: number }> = {};
    for (const field of rowFields) {
      tracking[field] = {
        value: rows[0]!.rowHeaders[field],
        startIndex: 0,
      };
    }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      let parentChanged = false;

      for (let j = 0; j < rowFields.length; j++) {
        const field = rowFields[j]!;
        const val = row.rowHeaders[field];
        const tracker = tracking[field]!;

        const isSpecialRow = row.type !== 'data';
        const prevRow = rows[i - 1];
        const prevWasSpecial = prevRow && prevRow.type !== 'data';

        if (parentChanged || val !== tracker.value || isSpecialRow || prevWasSpecial) {
          const span = i - tracker.startIndex;
          if (span > 1) {
            mergeInfo[field]!.push({ startIndex: tracker.startIndex, span });
          }

          tracker.value = val;
          tracker.startIndex = i;
          parentChanged = true;
        }
      }
    }

    for (const field of rowFields) {
      const tracker = tracking[field]!;
      const span = rows.length - tracker.startIndex;
      if (span > 1) {
        mergeInfo[field]!.push({ startIndex: tracker.startIndex, span });
      }
    }

    return mergeInfo;
  }

  private generateColumnDefs(
    headerTree: PivotHeaderNode,
    config: PivotConfig
  ): { columns: ColumnDef[]; rowHeaderColumns: ColumnDef[] } {
    const rowHeaderColumns: ColumnDef[] = config.rowFields.map((fieldDef) => ({
      key: fieldDef.field,
      header: fieldDef.header ?? fieldDef.field,
      width: 150,
      pinned: 'left' as const,
      mergeStrategy: 'same-value' as const,
    }));

    const columns: ColumnDef[] = [];
    this.collectLeafColumns(headerTree, columns, config);

    return { columns, rowHeaderColumns };
  }

  private collectLeafColumns(
    node: PivotHeaderNode,
    columns: ColumnDef[],
    config: PivotConfig
  ): void {
    if (node.isLeaf && node.columnKey) {
      const valueField = config.valueFields.find(
        (vf) => node.columnKey?.endsWith('_' + vf.field) || node.columnKey === vf.field
      );

      const isSubtotal = node.columnKey.includes(PIVOT_KEY_SUBTOTAL);
      const isGrandTotal = node.columnKey.includes(PIVOT_KEY_GRANDTOTAL);
      const pivotType: 'data' | 'subtotal' | 'grandtotal' = isGrandTotal
        ? 'grandtotal'
        : isSubtotal
          ? 'subtotal'
          : 'data';

      columns.push({
        key: node.columnKey,
        header: node.label,
        width: 100,
        type: 'number',
        formatter: valueField?.formatter,
        pivotType,
        structural: isSubtotal || isGrandTotal,
        pivotValueField: valueField?.field,
      });
      return;
    }

    for (const child of node.children) {
      this.collectLeafColumns(child, columns, config);
    }
  }
}
