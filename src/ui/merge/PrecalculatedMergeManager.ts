import { MergeManager, type MergeManagerConfig, type MergedRange } from './MergeManager';
import type { RowMergeInfo } from '../../types/pivot.types';
import type { Row as RowData } from '../../types/data.types';

/**
 * PrecalculatedMergeManager - 사전 계산된 병합 정보 사용
 * 
 * Worker 등에서 이미 계산된 병합 정보(RowMergeInfo)를 사용하여 병합을 처리합니다.
 * Lazy Loading 환경에서 데이터가 부분적으로만 존재할 때 유용합니다.
 */
export class PrecalculatedMergeManager extends MergeManager {
    private rawMergeInfo: Record<string, RowMergeInfo[]>;
    private precomputedRanges: Map<string, MergedRange> = new Map();
    private isPrecomputed = false;

    constructor(
        mergeInfo: Record<string, RowMergeInfo[]>,
        config?: MergeManagerConfig
    ) {
        super(config);
        this.rawMergeInfo = mergeInfo;
    }

    override invalidateCache(): void {
        super.invalidateCache();
        this.precomputedRanges.clear();
        this.isPrecomputed = false;
    }

    // 데이터가 변경되어도 재계산할 필요 없음 (이미 rawMergeInfo가 있으므로)
    // 단, 컬럼 인덱스가 바뀌면(setColumns) 다시 계산해야 함 -> invalidateCache에서 처리됨

    private precomputeRanges(): void {
        if (this.isPrecomputed) return;

        this.precomputedRanges.clear();

        const targetColumns = this.config.columns && this.config.columns.length > 0
            ? this.config.columns
            : Object.keys(this.rawMergeInfo);

        for (const columnKey of targetColumns) {
            const colIndex = this.columnIndexMap.get(columnKey);
            if (colIndex === undefined || colIndex < 0) continue;

            const ranges = this.rawMergeInfo[columnKey];
            if (!ranges) continue;

            for (const info of ranges) {
                const range: MergedRange = {
                    startRow: info.startIndex,
                    endRow: info.startIndex + info.span - 1,
                    startCol: colIndex,
                    endCol: colIndex,
                };

                // 범위 내 모든 셀에 동일한 range 참조 저장
                for (let r = 0; r < info.span; r++) {
                    const rowIndex = info.startIndex + r;
                    this.precomputedRanges.set(`${rowIndex}:${columnKey}`, range);
                }
            }
        }

        this.isPrecomputed = true;
    }

    getMergedRange(
        rowIndex: number,
        columnKey: string,
        _data: readonly RowData[]
    ): MergedRange | null {
        // 컬럼 변경 등으로 초기화가 필요할 수 있음
        if (!this.isPrecomputed) {
            this.precomputeRanges();
        }

        return this.precomputedRanges.get(`${rowIndex}:${columnKey}`) ?? null;
    }
}
