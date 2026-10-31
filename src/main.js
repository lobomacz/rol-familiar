import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import { VAlert, VApp, VAvatar, VBadge, VBtn, VCard, VCardActions, VCardText, VCardTitle, VChip, VContainer, VDialog, VForm, VIcon, VList, VListItem, VListItemSubtitle, VListItemTitle, VMain, VProgressCircular, VProgressLinear, VSelect, VSheet, VSpacer, VSwitch, VTab, VTabs, VTextField, VTextarea, VToolbar, VToolbarTitle } from 'vuetify/components'
const components = { VAlert, VApp, VAvatar, VBadge, VBtn, VCard, VCardActions, VCardText, VCardTitle, VChip, VContainer, VDialog, VForm, VIcon, VList, VListItem, VListItemSubtitle, VListItemTitle, VMain, VProgressCircular, VProgressLinear, VSelect, VSheet, VSpacer, VSwitch, VTab, VTabs, VTextField, VTextarea, VToolbar, VToolbarTitle }
import * as directives from 'vuetify/directives'
import 'vuetify/styles'
import App from './App.vue'
import { appIcons } from './icons'

createApp(App).use(createVuetify({
  components, directives,
  defaults: { VTextField: { variant: 'outlined', color: 'primary', rounded: 'lg' }, VSelect: { variant: 'outlined', color: 'primary', rounded: 'lg' } },
  icons: { sets: { app: appIcons }, defaultSet: 'app' },
  theme: { defaultTheme: 'light', themes: { light: { colors: { primary: '#285e51' } } } },
})).mount('#app')
