/**
 * Arquero 타입 선언
 *
 * Arquero 라이브러리의 기본 타입을 선언합니다.
 * npm install 전에 타입 오류를 방지합니다.
 */

declare module 'arquero' {
  export interface Table {
    filter(predicate: unknown): Table;
    orderby(...keys: unknown[]): Table;
    derive(values: Record<string, unknown>): Table;
    groupby(...keys: string[]): Table;
    rollup(values: Record<string, unknown>): Table;
    array(column: string): unknown[];
    objects(): unknown[];
    select(...columns: string[]): Table;
    dedupe(): Table;
  }

  export function from(data: unknown[]): Table;
  export function desc(column: string): unknown;
  export function escape<T>(fn: T): T;

  export namespace op {
    function row_number(): unknown;
    function count(): unknown;
    function sum(column: string): unknown;
    function mean(column: string): unknown;
    function min(column: string): unknown;
    function max(column: string): unknown;
    function first(column: string): unknown;
    function last(column: string): unknown;
  }
}
