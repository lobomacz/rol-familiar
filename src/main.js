import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
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
