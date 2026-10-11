// Safari can ignore viewport zoom limits; keep its gesture fallback touch-only.
const touchInput = matchMedia('(any-pointer: coarse)');

function preventTouchZoom(event: Event): void {
  if (touchInput.matches && event.cancelable) event.preventDefault();
}

for (const gesture of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(gesture, preventTouchZoom, { passive: false });
}

export {};
