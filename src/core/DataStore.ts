/**
 * DataStore - 원본 및 뷰 데이터 저장소
 *
 * Grid의 원본 데이터와 뷰 데이터를 분리하여 보관합니다.
 * - sourceRows: 원본 데이터 (loadData로 설정, 변경 안됨)
 * - rows: 뷰 데이터 (피벗/필터/정렬 결과, 렌더링에 사용)
 *
 * 핵심 원칙:
 * 1. 원본 데이터는 불변 (sourceRows)
 * 2. 뷰 데이터는 가공 결과 (rows)
 * 3. 데이터 변경 시 이벤트 발행
 * 4. 인덱스로 빠른 접근 제공
 *
 * @example
 * const store = new DataStore(eventEmitter);
 *
 * // 원본 데이터 설정
 * store.setData(rows, columns);
 *
 * // 뷰 데이터 설정 (피벗 등)
 * store.setViewData(pivotedRows, pivotColumns);
 *
 * // 원본 데이터 조회
 * const source = store.getSourceData();
 *
 * // 뷰 데이터 조회 (렌더링용)
 * const view = store.getData();
 */

import type { Row, ColumnDef, RowChange } from '../types';
import type { EventEmitter } from './EventEmitter';

/**
 * DataStore 옵션
 */
export interface DataStoreOptions {
  /** 행 고유 ID로 사용할 컬럼 키 (기본값: 'id') */
  idKey?: string;
}

/**
 * 원본 및 뷰 데이터 저장소
 */
export class DataStore {
  /** 원본 데이터 배열 (불변) */
  private sourceRows: Row[] = [];

  /** 원본 컬럼 정의 배열 */
  private sourceColumns: ColumnDef[] = [];

  /** 뷰 데이터 배열 (렌더링용, 피벗/필터/정렬 결과) */
  private rows: Row[] = [];

  /** 뷰 컬럼 정의 배열 */
  private columns: ColumnDef[] = [];

  /** ID → 인덱스 매핑 (뷰 데이터 기준, 빠른 조회용) */
  private idToIndexMap = new Map<string | number, number>();

  /** 행 ID 컬럼 키 */
  private readonly idKey: string;

  /**
   * @param events - 이벤트 발행기
   * @param options - 옵션
   */
  constructor(
    private readonly events: EventEmitter,
    options: DataStoreOptions = {}
  ) {
    this.idKey = options.idKey ?? 'id';
  }

  // ==========================================================================
  // 데이터 설정
  // ==========================================================================

  /**
   * 원본 데이터와 컬럼 설정
   *
   * 원본 데이터와 뷰 데이터 모두 설정합니다.
   * 피벗이나 필터가 적용되지 않은 초기 상태입니다.
   *
   * @param rows - 행 데이터 배열
   * @param columns - 컬럼 정의 배열
   *
   * @example
   * store.setData(
   *   [{ id: 1, name: '홍길동' }, { id: 2, name: '김철수' }],
   *   [{ key: 'id', type: 'number' }, { key: 'name', type: 'string' }]
   * );
   */
  setData(rows: Row[], columns: ColumnDef[]): void {
    // 원본 데이터 저장
    this.sourceRows = rows;
    this.sourceColumns = columns;

    // 뷰 데이터도 동일하게 설정 (초기 상태)
    this.rows = rows;
    this.columns = columns;
    this.rebuildIdMap();

    this.events.emit('data:loaded', {
      rowCount: rows.length,
      columnCount: columns.length,
    });
  }

  /**
   * 뷰 데이터만 설정 (피벗, 필터 결과 등)
   *
   * 원본 데이터는 유지하고 뷰 데이터만 변경합니다.
   *
   * @param rows - 뷰 행 데이터 배열
   * @param columns - 뷰 컬럼 정의 배열
   *
   * @example
   * // 피벗 결과 설정
   * store.setViewData(pivotedRows, pivotColumns);
   */
  setViewData(rows: Row[], columns: ColumnDef[]): void {
    this.rows = rows;
    this.columns = columns;
    this.rebuildIdMap();

    this.events.emit('data:loaded', {
      rowCount: rows.length,
      columnCount: columns.length,
    });
  }

  /**
   * 뷰 데이터를 원본으로 복원
   *
   * 피벗이나 필터를 해제하고 원본 상태로 돌아갑니다.
   */
  resetToSource(): void {
    this.rows = this.sourceRows;
    this.columns = this.sourceColumns;
    this.rebuildIdMap();

    this.events.emit('data:loaded', {
      rowCount: this.rows.length,
      columnCount: this.columns.length,
    });
  }

  /**
   * 컬럼 정의만 설정 (뷰 컬럼)
   *
   * @param columns - 컬럼 정의 배열
   */
  setColumns(columns: ColumnDef[]): void {
    this.columns = columns;
  }

  // ==========================================================================
  // 데이터 읽기 (Read)
  // ==========================================================================

  /**
   * 뷰 데이터 반환 (렌더링용)
   *
   * 피벗/필터/정렬 결과가 적용된 데이터입니다.
   *
   * @returns 뷰 데이터 배열 (읽기 전용)
   */
  getData(): readonly Row[] {
    return this.rows;
  }

  /**
   * 원본 데이터 반환 (피벗 재계산 등에 사용)
   *
   * 원본 데이터는 loadData로 설정된 그대로 유지됩니다.
   *
   * @returns 원본 데이터 배열 (읽기 전용)
   */
  getSourceData(): readonly Row[] {
    return this.sourceRows;
  }

  /**
   * 뷰 컬럼 정의 반환 (렌더링용)
   *
   * @returns 뷰 컬럼 정의 배열 (읽기 전용)
   */
  getColumns(): readonly ColumnDef[] {
    return this.columns;
  }

  /**
   * 원본 컬럼 정의 반환
   *
   * @returns 원본 컬럼 정의 배열 (읽기 전용)
   */
  getSourceColumns(): readonly ColumnDef[] {
    return this.sourceColumns;
  }

  /**
   * 전체 행 수
   */
  getRowCount(): number {
    return this.rows.length;
  }

  /**
   * 컬럼 수
   */
  getColumnCount(): number {
    return this.columns.length;
  }

  /**
   * 인덱스로 단일 행 접근
   *
   * @param index - 행 인덱스
   * @returns 해당 행 또는 undefined
   *
   * @example
   * const row = store.getRowByIndex(0);
   * if (row) {
   *   console.log(row.name);
   * }
   */
  getRowByIndex(index: number): Row | undefined {
    return this.rows[index];
  }

  /**
   * 여러 인덱스로 행들 접근
   *
   * 가상화(Virtualization)에서 화면에 보이는 행들만 가져올 때 사용.
   *
   * @param indices - 가져올 행들의 인덱스 배열
   * @returns 해당 행들의 배열
   *
   * @example
   * // 화면에 보이는 인덱스들 (IndexManager에서 받음)
   * const visibleIndices = [3, 7, 12, 15, 20];
   * const visibleRows = store.getRowsByIndices(visibleIndices);
   */
  getRowsByIndices(indices: ArrayLike<number>): Row[] {
    const result: Row[] = [];
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      // noUncheckedIndexedAccess 옵션으로 인해 undefined 체크 필요
      if (index !== undefined) {
        const row = this.rows[index];
        if (row !== undefined) {
          result.push(row);
        }
      }
    }
    return result;
  }

  /**
   * ID로 행 접근
   *
   * @param id - 행 ID
   * @returns 해당 행 또는 undefined
   *
   * @example
   * const row = store.getRowById(1);
   */
  getRowById(id: string | number): Row | undefined {
    const index = this.idToIndexMap.get(id);
    return index !== undefined ? this.rows[index] : undefined;
  }

  /**
   * ID로 인덱스 조회
   *
   * @param id - 행 ID
   * @returns 해당 인덱스 또는 -1
   */
  getIndexById(id: string | number): number {
    return this.idToIndexMap.get(id) ?? -1;
  }

  /**
   * 컬럼 키로 컬럼 정의 조회
   *
   * @param key - 컬럼 키
   * @returns 컬럼 정의 또는 undefined
   */
  getColumnByKey(key: string): ColumnDef | undefined {
    return this.columns.find((col) => col.key === key);
  }

  // ==========================================================================
  // 데이터 추가 (Create)
  // ==========================================================================

  /**
   * 행 추가 (맨 끝에)
   *
   * @param row - 추가할 행
   * @returns 추가된 인덱스
   *
   * @example
   * const index = store.addRow({ id: 3, name: '박영희' });
   */
  addRow(row: Row): number {
    const index = this.rows.length;
    this.rows.push(row);
    this.addToIdMap(row, index);

    this.events.emit('data:rowAdded', {
      row,
      index,
    });

    return index;
  }

  /**
   * 특정 위치에 행 추가
   *
   * @param index - 삽입할 위치
   * @param row - 추가할 행
   *
   * @example
   * store.insertRow(0, { id: 0, name: '첫 번째' }); // 맨 앞에 추가
   */
  insertRow(index: number, row: Row): void {
    // 범위 체크
    const insertIndex = Math.max(0, Math.min(index, this.rows.length));

    // 삽입
    this.rows.splice(insertIndex, 0, row);

    // ID 맵 재구축 (인덱스가 밀리므로)
    this.rebuildIdMap();

    this.events.emit('data:rowAdded', {
      row,
      index: insertIndex,
    });
  }

  /**
   * 여러 행 추가 (맨 끝에)
   *
   * @param rows - 추가할 행들
   * @returns 추가된 시작 인덱스
   */
  addRows(rows: Row[]): number {
    const startIndex = this.rows.length;

    for (const row of rows) {
      this.rows.push(row);
      this.addToIdMap(row, this.rows.length - 1);
    }

    // 여러 행 추가는 data:updated 이벤트로
    const changes: RowChange[] = rows.map((row, i) => ({
      type: 'add' as const,
      index: startIndex + i,
      newData: row,
    }));

    this.events.emit('data:updated', { changes });

    return startIndex;
  }

  // ==========================================================================
  // 데이터 수정 (Update)
  // ==========================================================================

  /**
   * 행 전체 교체
   *
   * @param index - 행 인덱스
   * @param newRow - 새 행 데이터
   * @returns 성공 여부
   *
   * @example
   * store.updateRow(0, { id: 1, name: '홍길동', age: 30 });
   */
  updateRow(index: number, newRow: Row): boolean {
    const oldRow = this.rows[index];
    if (oldRow === undefined) {
      return false;
    }

    // 이전 ID 제거, 새 ID 추가
    this.removeFromIdMap(oldRow);
    this.rows[index] = newRow;
    this.addToIdMap(newRow, index);

    // 변경된 키 찾기
    const changedKeys = this.findChangedKeys(oldRow, newRow);

    this.events.emit('data:rowUpdated', {
      index,
      oldRow,
      newRow,
      changedKeys,
    });

    return true;
  }

  /**
   * 행 부분 수정
   *
   * @param index - 행 인덱스
   * @param updates - 수정할 필드들
   * @returns 성공 여부
   *
   * @example
   * store.patchRow(0, { age: 31 }); // age만 수정
   */
  patchRow(index: number, updates: Partial<Row>): boolean {
    const oldRow = this.rows[index];
    if (oldRow === undefined) {
      return false;
    }

    // 새 행 생성 (불변성 유지)
    const newRow = { ...oldRow, ...updates };

    // ID가 바뀌었다면 맵 업데이트
    if (this.idKey in updates) {
      this.removeFromIdMap(oldRow);
      this.addToIdMap(newRow, index);
    }

    this.rows[index] = newRow;

    const changedKeys = Object.keys(updates);

    this.events.emit('data:rowUpdated', {
      index,
      oldRow,
      newRow,
      changedKeys,
    });

    return true;
  }

  /**
   * 셀 값 수정
   *
   * @param index - 행 인덱스
   * @param columnKey - 컬럼 키
   * @param value - 새 값
   * @returns 성공 여부
   *
   * @example
   * store.setCellValue(0, 'name', '홍길순');
   */
  setCellValue(
    index: number,
    columnKey: string,
    value: Row[string]
  ): boolean {
    return this.patchRow(index, { [columnKey]: value });
  }

  // ==========================================================================
  // 데이터 삭제 (Delete)
  // ==========================================================================

  /**
   * 행 삭제
   *
   * @param index - 삭제할 행 인덱스
   * @returns 삭제된 행 또는 undefined
   *
   * @example
   * const deleted = store.removeRow(0);
   */
  removeRow(index: number): Row | undefined {
    const row = this.rows[index];
    if (row === undefined) {
      return undefined;
    }

    // 삭제
    this.rows.splice(index, 1);

    // ID 맵 재구축 (인덱스가 당겨지므로)
    this.rebuildIdMap();

    this.events.emit('data:rowRemoved', {
      row,
      index,
    });

    return row;
  }

  /**
   * ID로 행 삭제
   *
   * @param id - 삭제할 행 ID
   * @returns 삭제된 행 또는 undefined
   */
  removeRowById(id: string | number): Row | undefined {
    const index = this.idToIndexMap.get(id);
    if (index === undefined) {
      return undefined;
    }
    return this.removeRow(index);
  }

  /**
   * 여러 행 삭제
   *
   * @param indices - 삭제할 인덱스들 (내림차순 정렬 권장)
   * @returns 삭제된 행들
   */
  removeRows(indices: number[]): Row[] {
    // 내림차순 정렬 (뒤에서부터 삭제해야 인덱스 안 꼬임)
    const sortedIndices = [...indices].sort((a, b) => b - a);

    const removedRows: Row[] = [];
    const changes: RowChange[] = [];

    for (const index of sortedIndices) {
      const row = this.rows[index];
      if (row !== undefined) {
        this.rows.splice(index, 1);
        removedRows.push(row);
        changes.push({
          type: 'remove',
          index,
          oldData: row,
        });
      }
    }

    // ID 맵 재구축
    this.rebuildIdMap();

    if (changes.length > 0) {
      this.events.emit('data:updated', { changes });
    }

    return removedRows;
  }

  /**
   * 모든 데이터 삭제
   */
  clear(): void {
    const oldCount = this.rows.length;
    this.rows = [];
    this.idToIndexMap.clear();

    if (oldCount > 0) {
      this.events.emit('data:loaded', {
        rowCount: 0,
        columnCount: this.columns.length,
      });
    }
  }

  // ==========================================================================
  // 내부 헬퍼 메서드
  // ==========================================================================

  /**
   * ID → 인덱스 맵 재구축
   */
  private rebuildIdMap(): void {
    this.idToIndexMap.clear();
    this.rows.forEach((row, index) => {
      this.addToIdMap(row, index);
    });
  }

  /**
   * ID 맵에 추가
   */
  private addToIdMap(row: Row, index: number): void {
    const id = row[this.idKey];
    if (id !== null && id !== undefined) {
      this.idToIndexMap.set(id as string | number, index);
    }
  }

  /**
   * ID 맵에서 제거
   */
  private removeFromIdMap(row: Row): void {
    const id = row[this.idKey];
    if (id !== null && id !== undefined) {
      this.idToIndexMap.delete(id as string | number);
    }
  }

  /**
   * 변경된 키 찾기
   */
  private findChangedKeys(oldRow: Row, newRow: Row): string[] {
    const allKeys = new Set([
      ...Object.keys(oldRow),
      ...Object.keys(newRow),
    ]);

    const changedKeys: string[] = [];
    for (const key of allKeys) {
      if (oldRow[key] !== newRow[key]) {
        changedKeys.push(key);
      }
    }
    return changedKeys;
  }
}
