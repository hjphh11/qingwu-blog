/** Move the hero artwork between two measured layout slots, with scroll as the timeline. */
export function connectGuidePortrait(stage: HTMLElement, image: HTMLImageElement) {
  const anchor = stage.parentElement;
  const guide = document.querySelector<HTMLElement>('qingwu-article-guide');
  const standing = guide?.querySelector<HTMLImageElement>('.standing');
  const portrait = guide?.querySelector<HTMLImageElement>('.local-guide img');
  if (!anchor || !guide || !standing || !portrait) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const columns = matchMedia('(min-width: 760px)');
  let frame = 0;
  const reset = () => {
    stage.style.removeProperty('transform');
    stage.style.removeProperty('opacity');
    standing.style.removeProperty('opacity');
    portrait.style.removeProperty('opacity');
  };
  const update = () => {
    frame = 0;
    if (reduce.matches || !guide.hasAttribute('ready')) {
      reset();
      guide.toggleAttribute('docked', reduce.matches);
      return;
    }

    const target = columns.matches ? standing : portrait;
    const other = columns.matches ? portrait : standing;
    other.style.removeProperty('opacity');
    const from = anchor.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const y = window.scrollY;
    // Desktop arrives as the sidebar sticks. On mobile, land beside the first speech bubble.
    const end = columns.matches
      ? guide.getBoundingClientRect().top + y - parseFloat(getComputedStyle(standing.parentElement!).top)
      : to.top + y + to.height / 2 - window.innerHeight * .72;
    const progress = Math.max(0, Math.min(1, y / Math.max(1, end)));

    guide.toggleAttribute('docked', progress === 1);
    if (progress === 0 || progress === 1) {
      stage.style.removeProperty('transform');
      stage.style.opacity = progress === 1 ? '0' : '';
      target.style.opacity = progress === 0 ? '0' : '';
      return;
    }

    // Both slots use object-fit: contain. Scale the artwork, not the empty edges of its box.
    const ratio = image.naturalWidth / image.naturalHeight || 480 / 760;
    const scale = Math.min(to.width / ratio, to.height) / Math.min(from.width / ratio, from.height);
    const ease = progress * progress * (3 - 2 * progress);
    const x = (to.left + to.width / 2 - from.left - from.width / 2) * ease;
    const dy = (to.top + to.height / 2 - from.top - from.height / 2) * progress;
    stage.style.transform = `translate3d(${x}px,${dy}px,0) scale(${1 + (scale - 1) * ease})`;
    // The phone ends on a cropped portrait; blend that final change in framing.
    const blend = columns.matches ? 0 : Math.max(0, (progress - .85) / .15);
    stage.style.opacity = String(1 - blend);
    target.style.opacity = String(blend);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const resize = new ResizeObserver(schedule);
  for (const element of [anchor, guide, standing, portrait]) resize.observe(element);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  reduce.addEventListener('change', schedule);
  update();
  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    reduce.removeEventListener('change', schedule);
    reset();
    guide.removeAttribute('docked');
  };
}
