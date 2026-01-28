/**
 * <nav-sidebar> Web Component
 *
 * 모든 예제 페이지에서 공통으로 사용하는 좌측 사이드바 네비게이션.
 * 사용법: <script src="../shared/nav-sidebar.js"></script>
 *         <nav-sidebar></nav-sidebar>
 *
 * 현재 페이지는 URL 기반으로 자동 감지하여 active 표시합니다.
 */

const NAV_ITEMS = [
  { href: '../index.html', icon: '🏠', label: '홈', id: 'index' },
  { type: 'divider', label: '기본 기능' },
  { href: 'pinning.html', icon: '📌', label: '행/컬럼 고정' },
  { href: 'column-widths.html', icon: '📏', label: '컬럼 너비 & Flex' },
  { href: 'column-visibility.html', icon: '👁️', label: '필드 선택' },
  { href: 'selection-modes.html', icon: '🎯', label: '선택 모드' },
  { type: 'divider', label: '레이아웃' },
  { href: 'multi-row.html', icon: '📑', label: 'Multi-Row' },
  { href: 'grouping.html', icon: '📂', label: '행 그룹화' },
  { href: 'merge.html', icon: '🔗', label: '셀 병합' },
  { type: 'divider', label: '데이터' },
  { href: 'crud.html', icon: '✏️', label: 'CRUD & Undo/Redo' },
  { href: 'format-row.html', icon: '🎨', label: 'formatRow' },
  { type: 'divider', label: '피벗 & 대용량' },
  { href: 'pivot.html', icon: '📊', label: '피벗 그리드' },
  { href: 'worker-fetch.html', icon: '⚡', label: 'Worker 대용량 피벗' },
  { href: 'worker-flat-api.html', icon: '🌐', label: 'API 대용량 플랫' },
];

class NavSidebar extends HTMLElement {
  connectedCallback() {
    const currentFile = location.pathname.split('/').pop() || '';
    // demo/index.html vs demo/examples/*.html 자동 감지
    const inExamples = location.pathname.includes('/examples/');
    const examplesPrefix = inExamples ? '' : 'examples/';
    const indexHref = inExamples ? '../index.html' : 'index.html';

    // 사이드바 토글 버튼 (모바일)
    const toggle = document.createElement('button');
    toggle.className = 'nav-sidebar-toggle';
    toggle.innerHTML = '☰';
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });

    const sidebar = document.createElement('aside');
    sidebar.className = 'nav-sidebar';

    // 제목
    const title = document.createElement('div');
    title.className = 'nav-sidebar-title';
    title.textContent = 'PureSheet Demos';
    sidebar.appendChild(title);

    // 메뉴 아이템
    const list = document.createElement('ul');
    list.className = 'nav-sidebar-list';

    for (const item of NAV_ITEMS) {
      if (item.type === 'divider') {
        const divider = document.createElement('li');
        divider.className = 'nav-sidebar-divider';
        divider.textContent = item.label;
        list.appendChild(divider);
        continue;
      }

      const li = document.createElement('li');
      const a = document.createElement('a');

      // 경로 보정: index는 별도 처리, 나머지는 prefix 추가
      if (item.id === 'index') {
        a.href = indexHref;
      } else {
        a.href = examplesPrefix + item.href;
      }

      a.className = 'nav-sidebar-link';

      // 현재 페이지 감지
      const itemFile = item.href.split('/').pop();
      if (itemFile === currentFile || (item.id === 'index' && (currentFile === 'index.html' || currentFile === ''))) {
        a.classList.add('active');
      }

      a.innerHTML = `<span class="nav-sidebar-icon">${item.icon}</span><span>${item.label}</span>`;
      li.appendChild(a);
      list.appendChild(li);
    }

    sidebar.appendChild(list);

    // 바깥 클릭 시 닫기 (모바일)
    document.addEventListener('click', (e) => {
      if (!sidebar.contains(e.target) && e.target !== toggle) {
        sidebar.classList.remove('open');
      }
    });

    this.appendChild(toggle);
    this.appendChild(sidebar);
  }
}

customElements.define('nav-sidebar', NavSidebar);
