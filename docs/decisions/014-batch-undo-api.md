# ADR-014: Batch Undo API

## 상태
- **제안일**: 2026-01-24
- **상태**: 승인됨

## 문맥

### 문제
드래그로 여러 Row를 선택하여 삭제할 때, 각 Row 삭제가 개별 Undo 항목으로 쌓여서 Ctrl+Z를 여러 번 눌러야 전체 복원이 가능하다.

### 현재 동작
```typescript
// 여러 Row 삭제 시
for (const rowId of selectedIds) {
  grid.deleteRowDirty(rowId);  // 각각 undoStack.push() 호출
}
// → Undo Stack: [Delete1, Delete2, Delete3]
// → Ctrl+Z 3번 필요
```

### 기대 동작
```typescript
grid.beginBatch('3개 행 삭제');
for (const rowId of selectedIds) {
  grid.deleteRowDirty(rowId);
}
grid.endBatch();
// → Undo Stack: [BatchCommand([Delete1, Delete2, Delete3])]
// → Ctrl+Z 1번으로 전체 복원
```

## 결정

### 용어 선택: Batch vs Transaction
- **Batch** 선택
- Transaction은 원자성(ACID) 개념이 강해 오버스펙
- 이미 `BatchCommand` 클래스가 존재하여 일관성 유지
- Excel, Google Sheets 등 스프레드시트 라이브러리에서도 Batch 용어 사용

### API 설계

```typescript
// UndoStack
class UndoStack {
  // 기존 메서드...
  
  /** Batch 모드 시작 */
  beginBatch(description?: string): void;
  
  /** Batch 모드 종료 및 BatchCommand 생성 */
  endBatch(): void;
  
  /** 현재 Batch 모드 여부 */
  get isBatching(): boolean;
}

// PureSheet 공개 API
class PureSheet {
  /** 여러 작업을 하나의 Undo 단위로 묶기 시작 */
  beginBatch(description?: string): void;
  
  /** Batch 모드 종료 */
  endBatch(): void;
}
```

### 동작 방식

1. `beginBatch()` 호출 시:
   - 내부 버퍼 배열 생성
   - `isBatching = true` 설정

2. Batch 모드에서 `push(command)` 호출 시:
   - 스택에 직접 추가하지 않고 버퍼에 저장
   - `command.execute()`는 즉시 실행

3. `endBatch()` 호출 시:
   - 버퍼에 명령이 있으면 `BatchCommand`로 래핑
   - 래핑된 `BatchCommand`를 스택에 push
   - 버퍼 및 `isBatching` 초기화

4. 예외 처리:
   - `beginBatch()` 없이 `endBatch()` 호출 시 무시
   - `endBatch()` 없이 새 `beginBatch()` 호출 시 기존 버퍼 자동 종료

## 구현 상세

### UndoStack 수정

```typescript
export class UndoStack extends SimpleEventEmitter<UndoStackEvents> {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly maxSize: number;
  
  // Batch 관련 추가
  private batchBuffer: Command[] | null = null;
  private batchDescription: string | undefined;

  beginBatch(description?: string): void {
    // 이미 batch 중이면 기존 것 종료
    if (this.batchBuffer !== null) {
      this.endBatch();
    }
    this.batchBuffer = [];
    this.batchDescription = description;
  }

  endBatch(): void {
    if (this.batchBuffer === null) return;
    
    if (this.batchBuffer.length > 0) {
      const batchCommand = new BatchCommand(
        this.batchBuffer,
        this.batchDescription
      );
      // 일반 push 로직 (execute 제외, 이미 실행됨)
      this.undoStack.push(batchCommand);
      this.redoStack = [];
      
      if (this.undoStack.length > this.maxSize) {
        this.undoStack.shift();
      }
      
      this.emit('push', { command: batchCommand });
      this.emitStateChange();
    }
    
    this.batchBuffer = null;
    this.batchDescription = undefined;
  }

  get isBatching(): boolean {
    return this.batchBuffer !== null;
  }

  push(command: Command): void {
    command.execute();
    
    if (this.batchBuffer !== null) {
      // Batch 모드: 버퍼에 저장
      this.batchBuffer.push(command);
      return;
    }
    
    // 일반 모드: 기존 로직
    this.undoStack.push(command);
    this.redoStack = [];
    // ...
  }
}
```

## 대안 검토

### 1. 콜백 방식
```typescript
grid.batch('설명', () => {
  grid.deleteRowDirty(id1);
  grid.deleteRowDirty(id2);
});
```
- 장점: 자동 종료 보장
- 단점: 비동기 작업 처리 어려움

### 2. 명시적 Command 배열 전달
```typescript
grid.executeBatch([
  new DeleteRowCommand(...),
  new DeleteRowCommand(...),
]);
```
- 장점: 명확함
- 단점: 내부 Command 클래스 노출 필요

**결정**: begin/end 패턴이 가장 유연하고 직관적

## 영향

### 수정 파일
1. `src/core/UndoStack.ts` - beginBatch, endBatch, isBatching 추가
2. `src/ui/PureSheet.ts` - 공개 API 추가
3. `src/types/crud.types.ts` - (필요시) 타입 추가

### 하위 호환성
- 완전 하위 호환
- 기존 개별 push 동작에 영향 없음
