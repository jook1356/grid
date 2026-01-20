/**
 * Row 모듈 진입점
 *
 * Row 클래스, RowRenderer 클래스와 관련 타입을 내보냅니다.
 *
 * - Row: 순수 데이터/상태 객체
 * - RowRenderer: 렌더링 전담 클래스
 *
 * @see docs/decisions/008-pivot-grid-architecture.md
 */

export { Row } from './Row';
export { RowRenderer } from './RowRenderer';
export type {
  RowVariant,
  RowConfig,
  GroupInfo,
  AggregateConfig,
  AggregateFunc,
  RowRenderContext,
  VirtualRowInfo,
} from './types';

