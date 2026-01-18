/**
 * 데이터 생성 웹 워커
 *
 * 대량의 테스트 데이터를 백그라운드에서 생성합니다.
 * 메인 스레드를 블로킹하지 않아 UI가 멈추지 않습니다.
 */

interface GenerateRequest {
  type: 'generate';
  count: number;
}

interface GenerateResponse {
  type: 'complete';
  data: Record<string, unknown>[];
  time: number;
}

interface ProgressResponse {
  type: 'progress';
  percent: number;
}

type WorkerMessage = GenerateRequest;
type WorkerResponse = GenerateResponse | ProgressResponse;

// 테스트 데이터 생성
function generateData(count: number): Record<string, unknown>[] {
  const statuses = ['Active', 'Inactive', 'Pending', 'Suspended'];
  const departments = ['Engineering', 'Sales', 'Marketing', 'HR', 'Finance'];

  const data: Record<string, unknown>[] = new Array(count);

  // 진행률 업데이트 간격 (10만 건마다)
  const progressInterval = Math.max(100000, Math.floor(count / 10));

  for (let i = 0; i < count; i++) {
    data[i] = {
      id: i + 1,
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      department: departments[i % departments.length],
      status: statuses[i % statuses.length],
      salary: Math.floor(50000 + Math.random() * 100000),
      joinDate: new Date(
        2020,
        Math.floor(Math.random() * 48),
        Math.floor(Math.random() * 28) + 1
      )
        .toISOString()
        .split('T')[0],
    };

    // 진행률 보고 (10만 건마다)
    if ((i + 1) % progressInterval === 0) {
      const percent = Math.round(((i + 1) / count) * 100);
      self.postMessage({ type: 'progress', percent } as ProgressResponse);
    }
  }

  return data;
}

// 메시지 핸들러
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === 'generate') {
    const startTime = performance.now();
    const data = generateData(message.count);
    const time = performance.now() - startTime;

    self.postMessage({
      type: 'complete',
      data,
      time,
    } as WorkerResponse);
  }
};
