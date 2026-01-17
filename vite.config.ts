import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  // 빌드 설정
  build: {
    // 라이브러리 모드로 빌드
    lib: {
      // 진입점 파일
      entry: resolve(__dirname, 'src/index.ts'),
      // 라이브러리 이름 (UMD 빌드시 전역 변수명)
      name: 'PureSheet',
      // 출력 파일명 패턴
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`,
    },
    // 출력 형식: ES Module + CommonJS
    rollupOptions: {
      // 번들에 포함하지 않을 외부 패키지
      external: ['arquero'],
      output: [
        {
          format: 'es',
          entryFileNames: 'index.js',
        },
        {
          format: 'cjs',
          entryFileNames: 'index.cjs',
        },
      ],
    },
    // 소스맵 생성 (디버깅용)
    sourcemap: true,
    // 출력 폴더 비우기
    emptyOutDir: true,
  },

  // 플러그인
  plugins: [
    // TypeScript 타입 정의 파일(.d.ts) 자동 생성
    dts({
      include: ['src/**/*'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    }),
  ],

  // 경로 별칭 (tsconfig.json과 맞춤)
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },

  // 테스트 설정 (Vitest)
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 60000, // 성능 테스트를 위해 타임아웃 연장
    // Web Worker 테스트 지원
    deps: {
      inline: ['@vitest/web-worker'],
    },
  },
});
