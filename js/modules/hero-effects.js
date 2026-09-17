/**
 * 滚动揭示动画模块
 *
 * 只观察「当前活动页签」内的 .grid：
 *   - 非活动页签是 display:none，把它们的 .grid 挂到 observer 上既不会触发，
 *     又会在隐藏期间干扰 revealed 状态，导致切回来时永远停在 opacity:0。
 *   - 每次切换页签后重新观察新展示出来的 .grid。
 */

let revealObserver = null;

/**
 * 对当前可见（活动页签内）的 .grid 建立滚动揭示观察
 */
function revealActiveSection() {
  if (!revealObserver) return;
  document.querySelectorAll('.category-section.active .grid').forEach(el => {
    if (!el.classList.contains('scroll-reveal')) {
      el.classList.add('scroll-reveal');
    }
    revealObserver.observe(el);
  });
}

function initScrollReveal() {
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        revealObserver.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -40px 0px'
  });

  revealActiveSection();
}

export { initScrollReveal, revealActiveSection };
