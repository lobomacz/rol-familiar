<script setup>
import { onMounted, onBeforeUnmount, reactive, ref, defineAsyncComponent } from 'vue'
import useVuelidate from '@vuelidate/core'
import { required, helpers } from '@vuelidate/validators'
import PasswordChangeDialog from './components/PasswordChangeDialog.vue'
const MainPage = defineAsyncComponent(() => import('./pages/MainPage.vue'))
const NewUserPage = defineAsyncComponent(() => import('./pages/NewUserPage.vue'))

const user = ref(null)
const page = ref(location.pathname)
const mainTab = ref('roles')
const exploreTab = ref('weeks')
const newUserOrigin = ref('perfil')
const checking = ref(true)
const loading = ref(false)
const popup = ref(false)
const networkError = ref('')
const form = reactive({ username: '', password: '' })
const validation = useVuelidate({
  username: { required: helpers.withMessage('Ingrese su usuario', required) },
  password: { required: helpers.withMessage('Ingrese su contraseña', required) },
}, form)
function redirect(path) { page.value = path; if (location.pathname !== path) history.replaceState(null, '', path) }
function openNewUser(origin = 'perfil') {
  if (!['admin', 'superadmin'].includes(user.value?.rol_usuario)) return
  newUserOrigin.value = origin
  redirect('/usuarios/nuevo')
}
function backFromNewUser() { mainTab.value = newUserOrigin.value; exploreTab.value = 'users'; redirect('/roles') }
function userSaved() { mainTab.value = 'explorar'; exploreTab.value = 'users'; redirect('/roles') }
function expired() { user.value = null; redirect('/login') }
async function restoreSession() {
  try {
    const response = await fetch('/api/auth/me')
    if (response.ok) {
      user.value = (await response.json()).user
      const canCreate = ['admin', 'superadmin'].includes(user.value.rol_usuario)
      redirect(location.pathname === '/usuarios/nuevo' && canCreate ? '/usuarios/nuevo' : '/roles')
    } else if (response.status === 401) {
      user.value = null
      redirect('/login')
    } else throw new Error('session')
  } catch { networkError.value = 'No se pudo conectar con el servidor. Intente de nuevo.' }
  finally { checking.value = false }
}
async function login() {
  if (!(await validation.value.$validate())) return
  loading.value = true
  networkError.value = ''
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (response.status === 401 || response.status === 429) { popup.value = true; return }
    if (!response.ok) throw new Error('login')
    user.value = (await response.json()).user
    mainTab.value = 'roles'
    form.password = ''
    validation.value.$reset()
    redirect('/roles')
  } catch { networkError.value = 'No se pudo conectar con el servidor. Intente de nuevo.' }
  finally { loading.value = false }
}
async function logout() {
  loading.value = true
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' })
    if (!response.ok) throw new Error('logout')
    user.value = null
    form.password = ''
    redirect('/login')
  } catch { networkError.value = 'No se pudo cerrar la sesión. Intente de nuevo.' }
  finally { loading.value = false }
}
onMounted(() => { restoreSession(); window.addEventListener('popstate', restoreSession) })
onBeforeUnmount(() => window.removeEventListener('popstate', restoreSession))
</script>

<template>
  <v-app>
    <v-main class="bg-grey-lighten-4">
      <v-container v-if="checking" class="text-center py-16"><v-progress-circular indeterminate aria-label="Cargando" /></v-container>
      <template v-else-if="user">
        <v-alert v-if="networkError" type="error" role="alert">{{ networkError }}</v-alert>
        <PasswordChangeDialog v-if="user.password_reset_at" forced @saved="restoreSession" @unauthorized="expired" @logout="logout" />
        <NewUserPage v-else-if="page === '/usuarios/nuevo' && ['admin', 'superadmin'].includes(user.rol_usuario)" :user="user" @back="backFromNewUser" @saved="userSaved" @unauthorized="expired" />
        <MainPage v-else :user="user" :logging-out="loading" :initial-tab="mainTab" :initial-explore-tab="exploreTab" @logout="logout" @new-user="openNewUser" @unauthorized="expired" />
      </template>
      <v-container v-else class="login-container">
        <v-card class="pa-6 pa-sm-8 rounded-xl" width="100%" max-width="420" elevation="3">
          <p class="text-overline text-primary">Rol Familiar</p>
          <h1 class="text-h5 font-weight-bold mb-2">Iniciar sesión</h1>
          <p class="text-body-2 text-medium-emphasis mb-6">Ingrese sus datos para continuar.</p>
          <v-alert v-if="networkError" type="error" role="alert" class="mb-4">{{ networkError }}</v-alert>
          <v-form @submit.prevent="login">
            <v-text-field v-model="form.username" label="Usuario" autocomplete="username" maxlength="100"
              :error-messages="validation.username.$errors.map(error => error.$message)" @blur="validation.username.$touch()" />
            <v-text-field v-model="form.password" label="Contraseña" type="password" autocomplete="current-password" maxlength="1024"
              :error-messages="validation.password.$errors.map(error => error.$message)" @blur="validation.password.$touch()" />
            <v-btn type="submit" color="primary" class="responsive-action" size="large" :loading="loading">Ingresar</v-btn>
          </v-form>
        </v-card>
      </v-container>
      <v-dialog v-model="popup" max-width="380" aria-labelledby="login-error-title">
        <v-card rounded="lg">
          <v-card-title id="login-error-title">Acceso denegado</v-card-title>
          <v-card-text role="alert">Sus datos de acceso no son correctos!</v-card-text>
          <v-card-actions><v-spacer /><v-btn color="primary" @click="popup = false">Aceptar</v-btn></v-card-actions>
        </v-card>
      </v-dialog>
    </v-main>
  </v-app>
</template>

<style scoped>
.login-container { min-height: 100vh; min-height: 100dvh; padding-block: max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-bottom)); display: flex; align-items: center; justify-content: center; }
</style>

<style>
.responsive-action { width: 100%; }
@media (min-width: 760px) {
  .responsive-action { width: auto; min-width: 144px; }
}
</style>
