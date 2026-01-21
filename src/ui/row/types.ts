/**
 * Row 클래스 관련 타입 정의
 *
 * Row 클래스는 Body, 고정 영역 모두에서 사용되는 통합 행 추상화입니다.
 * - structural: 구조적 행 여부 (선택/인덱스 제외)
 * - variant: 렌더링 힌트 (data, group-header, subtotal 등)
 * - pinned: 고정 위치 (top, bottom)
 */

import type { ColumnDef, CellValue } from '../../types';
import type { ColumnState, ColumnGroups } from '../types';
import type { GridCore } from '../../core/GridCore';
import type { CellMergeInfo } from '../merge/MergeManager';

// =============================================================================
// Row Variant (행 변형)
// =============================================================================

/**
 * 행 변형 타입
 *
 * 렌더링 힌트로 사용됩니다. structural 속성과 함께 행의 동작을 결정합니다.
 */
export type RowVariant =
  | 'data'          // 일반 데이터 행
  | 'group-header'  // 그룹 헤더 (접기/펼치기)
  | 'subtotal'      // 부분합 (그룹 소계)
  | 'grandtotal'    // 총합계
  | 'filter'        // 필터 입력 행
  | 'custom';       // 사용자 정의

// =============================================================================
// 그룹 정보
// =============================================================================

/**
 * 그룹 정보 (그룹 헤더, 소계 행용)
 */
export interface GroupInfo {
  /** 그룹 식별자 (토글용) */
  id: string;

  /** 계층 깊이 (0부터 시작) */
  level: number;

  /** 그룹 경로 (예: ['지역A', '제품X']) */
  path: string[];

  /** 그룹 값 (표시용) */
  value: CellValue;

  /** 그룹 컬럼 키 */
  column: string;

  /** 접힘 상태 */
  collapsed: boolean;

  /** 그룹 내 항목 수 */
  itemCount: number;

  /** 집계 값들 (컬럼 키 → 값) */
  aggregates?: Record<string, CellValue>;
}

// =============================================================================
// 집계 설정
// =============================================================================

/**
 * 집계 함수 타입
 */
export type AggregateFunc =
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'count'
  | ((values: CellValue[]) => CellValue);

/**
 * 집계 설정
 */
export interface AggregateConfig {
  /** 대상 컬럼 키 */
  columnKey: string;

  /** 집계 함수 */
  func: AggregateFunc;

  /** 표시 포맷터 */
  formatter?: (value: CellValue) => string;

  /** 라벨 (선택) */
  label?: string;
}

// =============================================================================
// Row 렌더링 컨텍스트
// =============================================================================

/**
 * 셀 병합 정보 조회 함수 타입
 */
export type MergeInfoGetter = (rowIndex: number, columnKey: string) => CellMergeInfo;

/**
 * 행 렌더링 컨텍스트
 *
 * Row.render() 호출 시 전달되는 컨텍스트 정보입니다.
 */
export interface RowRenderContext {
  /** 컬럼 상태 배열 */
  columns: ColumnState[];

  /** 컬럼 그룹 (Left/Center/Right) */
  columnGroups: ColumnGroups;

  /** 컬럼 정의 맵 (key → ColumnDef) */
  columnDefs: Map<string, ColumnDef>;

  /** 기본 행 높이 */
  rowHeight: number;

  /** GridCore 참조 (데이터 접근용) */
  gridCore: GridCore;

  /** 현재 행 인덱스 (가상화 기준) */
  rowIndex: number;

  /** 데이터 인덱스 (non-structural만, 원본 데이터 기준) */
  dataIndex?: number;

  /**
   * 셀 병합 정보 조회 함수 (선택)
   *
   * MergeManager가 설정된 경우 BodyRenderer에서 제공합니다.
   * 호출 시 해당 셀의 병합 정보를 반환합니다.
   */
  getMergeInfo?: MergeInfoGetter;
}

// =============================================================================
// Row 설정
// =============================================================================

/**
 * Row 생성 설정
 */
export interface RowConfig {
  /** 행 ID (선택, 미지정 시 자동 생성) */
  id?: string;

  /** 구조적 행 여부 (선택/인덱스 제외) @default false */
  structural?: boolean;

  /** 행 변형 (렌더링 힌트) @default 'data' */
  variant?: RowVariant;

  /** 고정 위치 @default null */
  pinned?: 'top' | 'bottom' | null;

  /** 행 높이 (null이면 기본값 사용) */
  height?: number | null;

  /** 행 데이터 */
  data?: Record<string, unknown>;

  /** 그룹 정보 (variant: 'group-header' | 'subtotal') */
  group?: GroupInfo;

  /** 집계 설정 (variant: 'subtotal' | 'grandtotal') */
  aggregates?: AggregateConfig[];

  /** 커스텀 렌더러 (variant: 'custom') */
  render?: (container: HTMLElement, context: RowRenderContext) => void;

  /** CSS 클래스 (추가) */
  className?: string;
}

// =============================================================================
// VirtualRow (내부용)
// =============================================================================

/**
 * 가상화된 행 (BodyRenderer 내부용)
 *
 * Row 인스턴스와 추가 메타데이터를 포함합니다.
 */
export interface VirtualRowInfo {
  /** Row 인스턴스 */
  row: import('./Row').Row;

  /** 구조적 행 여부 (Row.structural 미러링) */
  structural: boolean;

  /** 데이터 인덱스 (non-structural만) */
  dataIndex?: number;

  /** 그룹 경로 (그룹화된 경우) */
  groupPath?: string[];

  /** 그룹 레벨 */
  level?: number;
}

