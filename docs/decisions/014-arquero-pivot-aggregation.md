# 014. 아르케로(Arquero) 기반 피벗 집계 (Arquero-based Pivot Aggregation)

## 배경 (Context)
현재 피벗 그리드의 소계(Subtotal) 및 총합계(Grand Total) 계산은 다음과 같은 방식으로 이루어지고 있습니다:
1.  Arquero를 사용하여 최하위 그룹(Leaf Group) 수준의 집계를 수행합니다.
2.  JavaScript 코드로 이 결과(이미 집계된 값들)를 순회하며 상위 그룹의 소계를 **재집계(Re-aggregation)**합니다.

이 방식은 `Sum`(합계), `Min`(최소), `Max`(최대)와 같은 연산에는 문제가 없으나, **`Avg`(평균)**와 같은 연산에서는 수학적 오류를 야기합니다. 그룹별 데이터 개수가 다른 경우, "평균의 평균"은 "전체의 평균(가중 평균)"과 일치하지 않기 때문입니다.

또한, 대용량 데이터 처리 시 JavaScript 루프를 사용하여 재귀적으로 집계를 수행하는 것은 Arquero의 최적화된 내부 엔진을 활용하는 것보다 성능 효율이 떨어집니다.

## 결정 (Decision)
피벗의 모든 집계(소계, 총합계 포함)를 **Arquero의 `rollup` 기능**을 사용하여 수행하기로 결정했습니다.

### 변경 전 (As-Is)
- **Leaf Level**: Arquero `groupby(...allRowFields, ...allColFields).rollup(...)`
- **Subtotal/GrandTotal**: JS Loop로 Leaf Level 결과물을 다시 순회하며 집계. (평균의 평균 오류 발생)

### 변경 후 (To-Be)
- **Multi-pass Aggregation**: 필요한 모든 레벨에 대해 별도의 Arquero 쿼리를 실행합니다.
    1.  **Leaf Level**: `groupby(Product, Region).rollup(...)`
    2.  **Product Subtotal**: `groupby(Product).rollup(...)`
    3.  **Grand Total**: `rollup(...)`
- 이렇게 계산된 각각의 결과 테이블(Table)을 하나의 구조로 병합하여 그리드에 제공합니다.

## 장점 (Pros)
1.  **정합성 (Correctness)**: 원본 데이터를 기반으로 직접 집계하므로, 가중치가 반영된 정확한 평균값을 얻을 수 있습니다.
2.  **성능 (Performance)**: Arquero의 최적화된 컬럼 기반 연산을 활용하므로 대량 데이터 처리에 유리합니다.
3.  **유지보수성**: 복잡한 재귀적 합산 로직(JS)을 제거하고, 선언적인 Arquero 쿼리로 대체하여 코드가 간결해집니다.

## 단점 (Cons)
1.  **메모리 사용**: 여러 레벨의 집계 테이블을 생성해야 하므로 일시적인 메모리 사용량이 증가할 수 있습니다. (하지만 Result Set 자체가 크지 않으므로 큰 문제는 아닐 것으로 예상)
2.  **복잡도 이동**: JS 로직 복잡도는 줄어들지만, 여러 테이블을 병합(Join/Union)하고 정렬하는 과정이 추가됩니다.

## 구현 계획 (Plan)
1.  `PivotProcessor`의 `aggregateData` 메서드를 수정하여 다중 레벨 `rollup`을 수행하도록 변경.
2.  각 레벨별 결과를 적절한 Key로 맵핑(Mapping).
3.  기존 `createSubtotalRow` 등의 수동 집계 로직 제거 및 맵핑된 값 조회 방식으로 변경.
