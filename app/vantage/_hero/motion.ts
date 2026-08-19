declare global {
  interface Window {
    __vantageMotionFallback?: number;
  }
}

/**
 * Runs in <head> before first paint so the entrance timeline never flashes
 * finished state. The fallback timer clears the pending class if the demo
 * card's `animationend` never arrives (e.g. a backgrounded tab).
 */
export const MOTION_PENDING_SCRIPT = `(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  root.classList.add('motion-pending');
  window.__vantageMotionFallback = window.setTimeout(function () {
    root.classList.remove('motion-pending');
    window.__vantageMotionFallback = 0;
  }, 3500);
})();`;
