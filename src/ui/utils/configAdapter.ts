/**
 * Config Adapter - PureSheetConfig를 내부 구조로 변환
 *
 * 새로운 PureSheetConfig를 내부에서 사용하는 형식으로 변환합니다.
 * 구버전 API(columns 기반)는 더 이상 지원하지 않습니다.
 */

import type { ColumnDef, Row } from '../../types';
import type {
  FieldDef,
  PureSheetConfig,
  FlatModeConfig,
  PivotModeConfig,
  FormatRowCallback,
  ApiConfig,
} from '../../types/field.types';
import { isFlatMode } from '../../types/field.types';
import type { GroupingConfig, RowTemplate } from '../../types/grouping.types';

/**
 * 내부 옵션 (렌더링용)
 */
export interface InternalOptions {
  columns: ColumnDef[];
  data?: Row[];
  api?: ApiConfig;
  rowHeight: number;
  headerHeight: number;
  selectionMode: 'none' | 'row' | 'range' | 'all';
  multiSelect: boolean;
  showCheckboxColumn: boolean;
  editable: boolean;
  resizableColumns: boolean;
  reorderableColumns: boolean;
  theme: 'light' | 'dark' | 'auto';
  groupingConfig?: GroupingConfig;
  rowTemplate?: RowTemplate;
  formatRow?: FormatRowCallback;
}

/**
 * FieldDef를 ColumnDef로 변환
 *
 * width/minWidth/maxWidth는 변환 없이 그대로 전달합니다.
 * 실제 CSS 스타일 적용은 HeaderCell에서 처리합니다.
 */
export function fieldToColumn(field: FieldDef): ColumnDef {
  return {
    key: field.key,
    type: field.dataType,
    label: field.header,
    width: field.width,
    minWidth: field.minWidth,
    maxWidth: field.maxWidth,
    flex: field.flex,
    sortable: field.sortable,
    filterable: field.filterable,
    editable: field.editable,
    readonly: field.readonly,
    hidden: field.hidden,
    frozen: field.pinned,
    formatter: field.formatter,
    aggregate: field.aggregate,
  };
}

/**
 * PureSheetConfig를 내부 옵션으로 변환
 */
export function configToInternalOptions(config: PureSheetConfig): InternalOptions {
  // 피벗 모드에서는 fields가 없으므로 빈 배열 사용
  // 피벗 모드에서 컬럼 정의는 피벗 결과에서 동적으로 생성됨
  const columns: ColumnDef[] = isFlatMode(config)
    ? config.fields.map(fieldToColumn)
    : [];

  // 행 높이 처리
  let rowHeight = config.rowHeight;
  if (!rowHeight && typeof config.rowStyle === 'string') {
    const heightMatch = config.rowStyle.match(/height:\s*(\d+)px/);
    if (heightMatch && heightMatch[1]) {
      rowHeight = parseInt(heightMatch[1], 10);
    }
  }

  // 헤더 높이 처리
  let headerHeight = config.headerHeight;
  if (!headerHeight && typeof config.headerStyle === 'string') {
    const heightMatch = config.headerStyle.match(/height:\s*(\d+)px/);
    if (heightMatch && heightMatch[1]) {
      headerHeight = parseInt(heightMatch[1], 10);
    }
  }

  // 기본 옵션 구성
  const options: InternalOptions = {
    columns,
    data: config.data,
    api: config.api,
    rowHeight: rowHeight ?? 36,
    headerHeight: headerHeight ?? 40,
    selectionMode: (config.selectionMode as InternalOptions['selectionMode']) ?? 'row',
    multiSelect: config.multiSelect ?? true,
    showCheckboxColumn: config.showCheckboxColumn ?? false,
    editable: config.editable ?? false,
    resizableColumns: config.resizableColumns ?? true,
    reorderableColumns: config.reorderableColumns ?? true,
    theme: config.theme ?? 'light',
    formatRow: config.formatRow,
  };

  // Flat 모드의 그룹핑 설정
  if (isFlatMode(config)) {
    const flatConfig = config as FlatModeConfig;

    if (flatConfig.group) {
      options.groupingConfig = {
        columns: flatConfig.group.columns,
        aggregates: flatConfig.group.subtotals
          ? Object.fromEntries(
            flatConfig.group.subtotals.map(key => {
              const field = config.fields.find(f => f.key === key);
              return [key, field?.aggregate ?? 'sum'];
            })
          )
          : undefined,
      };
    }

    // Multi-Row 템플릿
    if (flatConfig.rowTemplate) {
      options.rowTemplate = flatConfig.rowTemplate;
    }
  }

  return options;
}

/**
 * Config에서 모드 추출
 */
export function getGridMode(config: PureSheetConfig): 'flat' | 'pivot' {
  return config.mode ?? 'flat';
}

/**
 * Pivot Config 추출 (Pivot 모드일 때만)
 *
 * PivotModeConfig에서 PivotConfig를 추출합니다.
 * 피벗 모드에서는 rowFields, columnFields, valueFields가 이미 객체 배열입니다.
 *
 * @see docs/decisions/023-pivot-field-type-unification.md
 */
export function getPivotConfig(config: PureSheetConfig): import('../../types/pivot.types').PivotConfig | null {
  if (isFlatMode(config)) {
    return null;
  }

  const pivotMode = config as PivotModeConfig;

  // 피벗 모드에서는 rowFields, columnFields, valueFields가 이미 객체 배열
  return {
    rowFields: pivotMode.rowFields,
    columnFields: pivotMode.columnFields,
    valueFields: pivotMode.valueFields,
  };
}
