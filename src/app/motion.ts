/** True when the OS asks for reduced motion or the user turned it on in Settings → Display. */
export function prefersReducedMotion(): boolean {
  return (
    document.documentElement.dataset.reduceMotion === "true" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
