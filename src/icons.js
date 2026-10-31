import { h } from 'vue'
const paths = {
  'mdi-bell': 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2m6-6v-5c0-3.1-1.6-5.6-4.5-6.3V4a1.5 1.5 0 0 0-3 0v.7C7.6 5.4 6 7.9 6 11v5l-2 2v1h16v-1z',
  'mdi-alert': 'M1 21h22L12 2 1 21m12-3h-2v-2h2v2m0-4h-2v-4h2v4',

  'mdi-plus': 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  'mdi-menu-down': 'M7 10l5 5 5-5z',
  'mdi-chevron-down': 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z',
  'mdi-account': 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m0 2c-4.4 0-8 2-8 4.5V21h16v-2.5C20 16 16.4 14 12 14',
  'mdi-account-outline': 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4m0 8c-4 0-8 2-8 5v2h16v-2c0-3-4-5-8-5m0 2c3.3 0 6 1.5 6 3H6c0-1.5 2.7-3 6-3',
  'mdi-menu': 'M3 6h18v2H3m0 3h18v2H3m0 3h18v2H3',
  'mdi-compass-outline': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16m5 3-7 3-3 7 7-3m-2-3a1 1 0 1 1 0 2 1 1 0 0 1 0-2',
  'mdi-square-edit-outline': 'M3 3h10v2H5v14h14v-8h2v10H3m17-20 3 3-10 10-4 1 1-4m10-7-8 8 1 1 8-8',
}
export const appIcons = { component: props => h('svg', { viewBox: '0 0 24 24', width: 24, height: 24, role: 'img', 'aria-hidden': 'true' }, [h('path', { d: paths[props.icon] || paths['mdi-account'], fill: 'currentColor' })]) }
