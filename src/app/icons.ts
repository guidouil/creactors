type IconName = 'arrow' | 'play' | 'pause' | 'replay' | 'remix' | 'cycle' | 'download' | 'edit' | 'cancel' | 'audio' | 'image' | 'dice' | 'help';

const paths: Record<IconName, string> = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  play: '<path d="m9 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3.5"/>',
  replay: '<path d="M4 10a8 8 0 1 1 .7 6M4 4v6h6"/>',
  remix: '<path d="M4 7h3c5 0 5 10 10 10h3M17 14l3 3-3 3M4 17h3c2 0 3-2 4-4m2-2c1-2 2-4 4-4h3M17 4l3 3-3 3"/>',
  cycle: '<path d="M20 8a8 8 0 0 0-14-2L3 9M3 3v6h6M4 16a8 8 0 0 0 14 2l3-3M21 21v-6h-6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 17v4h16v-4"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L20 8a2.1 2.1 0 0 0-4-4L5 15z"/>',
  cancel: '<path d="m6 6 12 12M6 18 18 6"/>',
  audio: '<path d="M9 17V5l11-2v12M9 9l11-2"/><ellipse cx="6" cy="17" rx="3" ry="2.5"/><ellipse cx="17" cy="15" rx="3" ry="2.5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 5 5 3-3 5 5"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><g fill="currentColor" stroke="none"><circle cx="8" cy="8" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="16" cy="16" r="1.3"/></g>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1.2-1.5 2.5"/><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none"/>',
};

export function icon(name: IconName): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
