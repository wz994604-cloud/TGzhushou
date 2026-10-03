const NativeMutationObserver = window.MutationObserver;

window.MutationObserver = class PreviewMutationObserver extends NativeMutationObserver {
  observe(target, options = {}) {
    if (target?.id === 'workspace' && options.subtree && options.childList) {
      return super.observe(target, { attributes:true, attributeFilter:['hidden'] });
    }
    return super.observe(target, options);
  }
};

try {
  await import('./ui-redesign-preview.js');
} finally {
  window.MutationObserver = NativeMutationObserver;
}
