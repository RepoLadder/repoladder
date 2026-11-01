// The top bar's four line icons: inline svgs (16x16, 1.5 stroke in currentColor, round caps), drawn for this bar.
const svg = (d: string) => `<svg class="bi" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONS = {
  search: svg(`<circle cx="7" cy="7" r="4.25"/><path d="M10.2 10.2 13.5 13.5"/>`),
  tour: svg(`<path d="M3 13.5V2.5"/><path d="M3 3h8.5l-2 2.75 2 2.75H3"/>`),
  export: svg(`<path d="M8 2.5v7.5"/><path d="M5 7.25 8 10.25l3-3"/><path d="M3 13h10"/>`),
  filter: svg(`<path d="M2.5 3.5h11"/><path d="M4.75 8h6.5"/><path d="M7 12.5h2"/>`),
};
