/**
 * 테스트 데이터 생성 유틸리티
 *
 * 요청한 개수만큼 테스트 데이터를 동적으로 생성합니다.
 * 파일로 저장하지 않고 메모리에서 반환합니다.
 *
 * @example
 * import { generateTestData } from './generateTestData';
 * const data = generateTestData(100000); // 10만 건 생성
 */

// =============================================================================
// 타입 정의
// =============================================================================

export interface TestRow {
  id: number;
  name: string;
  email: string;
  age: number;
  salary: number;
  department: string;
  position: string;
  hireDate: string;
  isActive: boolean;
  score: number;
}

// =============================================================================
// 샘플 데이터 풀
// =============================================================================

const FIRST_NAMES = [
  '민준', '서준', '도윤', '예준', '시우', '하준', '지호', '주원', '지후', '준서',
  '서연', '서윤', '지우', '서현', '민서', '하은', '하윤', '윤서', '지민', '채원',
  '현우', '준혁', '도현', '건우', '우진', '선우', '민재', '현준', '연우', '유준',
  '수아', '지아', '다은', '예은', '수빈', '지은', '채은', '유진', '소율', '시은',
];

const LAST_NAMES = [
  '김', '이', '박', '최', '정', '강', '조', '윤', '장', '임',
  '한', '오', '서', '신', '권', '황', '안', '송', '류', '전',
];

const DEPARTMENTS = [
  'Engineering', 'Marketing', 'Sales', 'HR', 'Finance',
  'Design', 'Product', 'Operations', 'Legal', 'Support',
];

const POSITIONS = [
  'Junior', 'Senior', 'Lead', 'Manager', 'Director',
  'VP', 'Intern', 'Specialist', 'Analyst', 'Consultant',
];

const EMAIL_DOMAINS = [
  'company.com', 'corp.co.kr', 'business.net', 'work.org', 'office.io',
];

// =============================================================================
// 유틸리티 함수
// =============================================================================

/**
 * 랜덤 정수 생성
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 배열에서 랜덤 요소 선택
 */
function randomChoice<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)]!;
}

/**
 * 랜덤 날짜 생성 (2010-01-01 ~ 2024-12-31)
 */
function randomDate(): string {
  const start = new Date(2010, 0, 1);
  const end = new Date(2024, 11, 31);
  const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return date.toISOString().split('T')[0]!;
}

/**
 * 랜덤 이메일 생성
 */
function randomEmail(id: number): string {
  const domain = randomChoice(EMAIL_DOMAINS);
  return `user${id}@${domain}`;
}

// =============================================================================
// 데이터 생성
// =============================================================================

/**
 * 단일 행 생성
 */
export function generateRow(id: number): TestRow {
  const firstName = randomChoice(FIRST_NAMES);
  const lastName = randomChoice(LAST_NAMES);
  const department = randomChoice(DEPARTMENTS);
  const position = randomChoice(POSITIONS);

  return {
    id,
    name: `${lastName}${firstName}`,
    email: randomEmail(id),
    age: randomInt(22, 60),
    salary: randomInt(3000, 15000) * 10000, // 3천만 ~ 1.5억
    department,
    position,
    hireDate: randomDate(),
    isActive: Math.random() > 0.1, // 90% 활성
    score: Math.round(Math.random() * 100 * 10) / 10, // 0.0 ~ 100.0
  };
}

/**
 * 테스트 데이터 배열 생성
 *
 * @param count - 생성할 행 수
 * @returns 테스트 데이터 배열
 *
 * @example
 * const data = generateTestData(1000); // 1000건 생성
 * const bigData = generateTestData(1000000); // 100만 건 생성
 */
export function generateTestData(count: number): TestRow[] {
  const data: TestRow[] = [];
  for (let i = 0; i < count; i++) {
    data.push(generateRow(i + 1));
  }
  return data;
}

/**
 * 컬럼 정의 반환
 */
export function getTestColumns() {
  return [
    { key: 'id', type: 'number' as const, label: 'ID' },
    { key: 'name', type: 'string' as const, label: '이름' },
    { key: 'email', type: 'string' as const, label: '이메일' },
    { key: 'age', type: 'number' as const, label: '나이' },
    { key: 'salary', type: 'number' as const, label: '급여' },
    { key: 'department', type: 'string' as const, label: '부서' },
    { key: 'position', type: 'string' as const, label: '직급' },
    { key: 'hireDate', type: 'string' as const, label: '입사일' },
    { key: 'isActive', type: 'boolean' as const, label: '활성' },
    { key: 'score', type: 'number' as const, label: '점수' },
  ];
}
