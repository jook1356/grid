/**
 * Config Adapter - PureSheetConfig를 내부 구조로 변환
 *
 * 새로운 PureSheetConfig를 내부에서 사용하는 형식으로 변환합니다.
 * 구버전 API(columns 기반)는 더 이상 지원하지 않습니다.
 */

import type { ColumnDef } from '../../types';
import type {
  FieldDef,
  PureSheetConfig,
  FlatModeConfig,
  PivotModeConfig,
} from '../../types/field.types';
import { isFlatMode } from '../../types/field.types';
import type { GroupingConfig, RowTemplate } from '../../types/grouping.types';

/**
 * 내부 옵션 (렌더링용)
 */
export interface InternalOptions {
  columns: ColumnDef[];
  data?: Record<string, unknown>[];
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
}

/**
 * FieldDef를 ColumnDef로 변환
 */
export function fieldToColumn(field: FieldDef): ColumnDef {
  // style에서 width 파싱
  let width = field.width;
  if (!width && field.style) {
    const widthMatch = field.style.match(/width:\s*(\d+)px/);
    if (widthMatch) {
      width = parseInt(widthMatch[1], 10);
    }
  }

  return {
    key: field.key,
    type: field.dataType,
    label: field.header,
    width: width ?? 150,
    minWidth: field.minWidth,
    maxWidth: field.maxWidth,
    sortable: field.sortable,
    filterable: field.filterable,
    editable: field.editable,
    hidden: field.hidden,
    formatter: field.formatter,
  };
}

/**
 * PureSheetConfig를 내부 옵션으로 변환
 */
export function configToInternalOptions(config: PureSheetConfig): InternalOptions {
  // fields → columns 변환
  const columns: ColumnDef[] = config.fields.map(fieldToColumn);

  // Flat 모드인 경우 컬럼 순서 적용
  if (isFlatMode(config)) {
    const flatConfig = config as FlatModeConfig;
    
    // columns 배열이 있으면 해당 순서대로 재정렬
    if (flatConfig.columns && flatConfig.columns.length > 0) {
      const orderedColumns: ColumnDef[] = [];
      const columnMap = new Map(columns.map(c => [c.key, c]));
      
      for (const key of flatConfig.columns) {
        const col = columnMap.get(key);
        if (col) {
          orderedColumns.push(col);
        }
      }
      
      // columns 배열에 없는 컬럼은 뒤에 추가 (hidden 처리)
      for (const col of columns) {
        if (!flatConfig.columns.includes(col.key)) {
          orderedColumns.push({ ...col, hidden: true });
        }
      }
      
      columns.length = 0;
      columns.push(...orderedColumns);
    }

    // pinned 설정 적용
    if (flatConfig.pinned) {
      for (const col of columns) {
        if (flatConfig.pinned.left?.includes(col.key)) {
          col.frozen = 'left';
        } else if (flatConfig.pinned.right?.includes(col.key)) {
          col.frozen = 'right';
        }
      }
    }
  }

  // 행 높이 처리
  let rowHeight = config.rowHeight;
  if (!rowHeight && config.rowStyle) {
    const heightMatch = config.rowStyle.match(/height:\s*(\d+)px/);
    if (heightMatch) {
      rowHeight = parseInt(heightMatch[1], 10);
    }
  }

  // 헤더 높이 처리
  let headerHeight = config.headerHeight;
  if (!headerHeight && config.headerStyle) {
    const heightMatch = config.headerStyle.match(/height:\s*(\d+)px/);
    if (heightMatch) {
      headerHeight = parseInt(heightMatch[1], 10);
    }
  }

  // 기본 옵션 구성
  const options: InternalOptions = {
    columns,
    data: config.data,
    rowHeight: rowHeight ?? 36,
    headerHeight: headerHeight ?? 40,
    selectionMode: (config.selectionMode as InternalOptions['selectionMode']) ?? 'row',
    multiSelect: config.multiSelect ?? true,
    showCheckboxColumn: config.showCheckboxColumn ?? false,
    editable: config.editable ?? false,
    resizableColumns: config.resizableColumns ?? true,
    reorderableColumns: config.reorderableColumns ?? true,
    theme: config.theme ?? 'light',
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
 */
export function getPivotConfig(config: PureSheetConfig): PivotModeConfig | null {
  if (!isFlatMode(config)) {
    return config as PivotModeConfig;
  }
  return null;
}
