<script setup>
import { computed, onMounted, ref } from 'vue'
import { canChangeUserRole } from '../helpers/user-role-policy.js'
import { userDisplayName } from '../helpers/user-display.js'
const props = defineProps({ user: { type: Object, required: true }, initialTab: { type: String, default: 'weeks' } })
const emit = defineEmits(['unauthorized', 'new-user', 'open-week'])
const canManage = computed(() => ['admin', 'superadmin'].includes(props.user.rol_usuario))
const tab = ref(props.initialTab), roles = ref([]), users = ref([]), loading = ref(true), error = ref(''), notice = ref('')
const resetting = ref(new Set())
const saving = ref(new Set()), dialog = ref(false)
const passwordResetTarget = ref(null), deactivationTarget = ref(null)
const resetConfirmation = computed({ get: () => Boolean(passwordResetTarget.value), set: value => { if (!value && !resetting.value.size) passwordResetTarget.value = null } })
const deactivateConfirmation = computed({ get: () => Boolean(deactivationTarget.value), set: value => { if (!value && !saving.value.size) deactivationTarget.value = null } })
function askPasswordReset(user) {
  if (!canManage.value || saving.value.has(user.id) || resetting.value.has(user.id)) return
  error.value = ''; passwordResetTarget.value = user
}
function requestActiveChange(user, active) {
  if (props.user.rol_usuario !== 'superadmin' || saving.value.has(user.id) || resetting.value.has(user.id)) return
  if (active) return setActive(user, true)
  error.value = ''; deactivationTarget.value = user
}
async function confirmPasswordReset() {
  const user = passwordResetTarget.value
  if (!user || resetting.value.has(user.id)) return
  if (await resetPassword(user)) passwordResetTarget.value = null
}
async function confirmDeactivation() {
  const user = deactivationTarget.value
  if (!user || saving.value.has(user.id)) return
  if (await setActive(user, false)) deactivationTarget.value = null
}
const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Managua', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
const currentMonth = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`
const month = ref(currentMonth), calendarMonth = ref(currentMonth)
const dateValue = date => new Date(`${date}T12:00:00Z`)
const iso = date => date.toISOString().slice(0, 10)
const addDays = (date, count) => { const value = dateValue(date); value.setUTCDate(value.getUTCDate() + count); return iso(value) }
const monday = date => addDays(date, -((dateValue(date).getUTCDay() + 6) % 7))
const formatDate = date => new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(dateValue(date))
const monthLabel = value => new Intl.DateTimeFormat('es-NI', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dateValue(`${value}-01`))
const weeks = computed(() => {
  const grouped = new Map()
  for (const role of roles.value) {
    const start = monday(role.date)
    if (!grouped.has(start)) grouped.set(start, { start, end: addDays(start, 6), roles: [] })
    grouped.get(start).roles.push(role)
  }
  return [...grouped.values()].reverse()
})
// Include weeks that overlap the selected month, including month boundaries.
const visibleWeeks = computed(() => weeks.value.filter(week => week.start.slice(0, 7) <= month.value && week.end.slice(0, 7) >= month.value))
const recordedWeeks = computed(() => new Set(weeks.value.map(week => week.start)))
const calendarDays = computed(() => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(calendarMonth.value)) return []
  const first = monday(`${calendarMonth.value}-01`)
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(first, i)
    return { date, day: dateValue(date).getUTCDate(), inMonth: date.startsWith(calendarMonth.value), available: recordedWeeks.value.has(monday(date)) }
  })
})
async function request(url, options) {
  const response = await fetch(url, options)
  if (response.status === 401) { emit('unauthorized'); throw new Error('La sesión ha vencido') }
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud')
  return data
}
async function load() {
  loading.value = true; error.value = ''
  try {
    const history = await request('/api/roles/history')
    roles.value = history.roles
    if (canManage.value) users.value = (await request('/api/users')).users
  } catch (err) { error.value = err.message }
  finally { loading.value = false }
}
async function setUserRole(person, role) {
  if (!canChangeUserRole(props.user, person) || saving.value.has(person.id) || resetting.value.has(person.id) || role === person.rol_usuario) return
  saving.value.add(person.id); error.value = ''; notice.value = ''
  try {
    const result = await request(`/api/users/${person.id}/role`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rol_usuario: role }) })
    person.rol_usuario = result.rol_usuario
    notice.value = `Rol de ${userDisplayName(person)} actualizado a ${result.rol_usuario}.`
  } catch (err) { error.value = err.message }
  finally { saving.value.delete(person.id) }
}
async function setActive(user, active) {
  saving.value.add(user.id); error.value = ''; notice.value = ''
  try {
    const result = await request(`/api/users/${user.id}/active`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: active }) })
    user.activo = result.activo
    notice.value = `${user.nombre}: ${active ? 'activo' : 'inactivo'}`
    if (user.id === props.user.id && !active) emit('unauthorized')
    return true
  } catch (err) { error.value = err.message; return false }
  finally { saving.value.delete(user.id) }
}
async function resetPassword(user) {
  if (resetting.value.has(user.id)) return
  resetting.value.add(user.id); error.value = ''; notice.value = ''
  try {
    const result = await request(`/api/users/${user.id}/reset-password`, { method: 'POST' })
    user.password_reset_at = result.password_reset_at
    notice.value = `Contraseña de ${user.nombre} restablecida a su nombre seguido del apellido, en minúsculas y sin espacios al inicio o final de cada campo. Deberá cambiarla al iniciar sesión.`
    if (user.id === props.user.id) emit('unauthorized')
    return true
  } catch (err) { error.value = err.message; return false }
  finally { resetting.value.delete(user.id) }
}
function selectWeek(day) {
  month.value = day.date.slice(0, 7)
  dialog.value = false
  emit('open-week', monday(day.date))
}
function browseMonth() { calendarMonth.value = month.value; dialog.value = true }
function applyMonth() { month.value = calendarMonth.value; dialog.value = false }
onMounted(load)
</script>

<template>
  <section class="explore-page" aria-labelledby="explore-title">
    <div class="explore-heading">
      <div><p class="text-overline text-primary">Organización familiar</p><h1 id="explore-title" class="text-h5 font-weight-bold">Explorar</h1></div>
    </div>
    <v-tabs v-if="canManage" v-model="tab" grow color="primary" class="explore-tabs" aria-label="Contenido de Explorar">
      <v-tab value="weeks">Semanas</v-tab><v-tab value="users">Usuarios</v-tab>
    </v-tabs>
    <v-alert v-if="error" type="error" variant="tonal" role="alert">{{ error }} <v-btn variant="text" @click="load">Reintentar</v-btn></v-alert>
    <v-alert v-if="notice" type="success" variant="tonal" role="status">{{ notice }}</v-alert>
    <div v-if="loading" class="text-center pa-8" role="status"><v-progress-circular indeterminate color="primary" aria-label="Cargando" /></div>
    <template v-else-if="tab === 'weeks' || !canManage">
      <v-text-field :model-value="monthLabel(month)" label="Buscar Semanas Por Mes" placeholder="Seleccionar Mes" density="compact" class="month-search" readonly hide-details @click="browseMonth" @keydown.enter.prevent="browseMonth" @keydown.space.prevent="browseMonth" aria-haspopup="dialog">
        <template #append-inner><v-btn variant="text" size="small" @click.stop="browseMonth">Buscar</v-btn></template>
      </v-text-field>
      <p class="text-body-2 text-medium-emphasis">{{ visibleWeeks.length }} semanas registradas · {{ monthLabel(month) }}</p>
      <v-list v-if="visibleWeeks.length" class="week-list" bg-color="transparent" aria-label="Semanas registradas">
        <v-list-item v-for="week in visibleWeeks" :key="week.start" rounded="lg" class="week-item" @click="emit('open-week', week.start)" :aria-label="`Ver semana del ${formatDate(week.start)} al ${formatDate(week.end)}`">
          <v-list-item-title class="wrap-text font-weight-bold">{{ formatDate(week.start) }} – {{ formatDate(week.end) }}</v-list-item-title>
          <v-list-item-subtitle>{{ week.roles.length }} asignaciones · Ver semana</v-list-item-subtitle>
        </v-list-item>
      </v-list>
      <v-sheet v-else border rounded="xl" class="pa-8 text-center text-medium-emphasis">No hay semanas registradas en este mes. Busca otro mes para consultar el historial.</v-sheet>
    </template>
    <template v-else-if="canManage && tab === 'users'">
      <div class="explore-heading">
        <p class="text-body-2 text-medium-emphasis">Administra quién puede iniciar sesión y recibir nuevas asignaciones.</p>
        <v-btn icon="mdi-plus" color="primary" variant="tonal" aria-label="Agregar nuevo usuario" title="Agregar nuevo usuario" @click="emit('new-user')" />
      </div>
      <v-list v-if="users.length" class="user-list" bg-color="transparent" aria-label="Usuarios registrados">
        <v-list-item v-for="person in users" :key="person.id" class="user-item" rounded="lg">
          <v-list-item-title class="wrap-text font-weight-bold">{{ userDisplayName(person) }}</v-list-item-title>
          <p class="text-caption text-medium-emphasis">{{ person.username }} · {{ person.rol_usuario }}</p>
          <v-select v-if="canChangeUserRole(user, person)" :model-value="person.rol_usuario" :items="['usuario', 'admin']" :aria-label="`Rol de usuario de ${userDisplayName(person)}`" label="Rol de usuario" density="compact" class="mt-3" hide-details :loading="saving.has(person.id)" :disabled="saving.has(person.id) || resetting.has(person.id)" @update:model-value="setUserRole(person, $event)" />
          <p class="text-body-2 mt-2">Último turno: {{ person.ultimo_rol ? formatDate(person.ultimo_rol) : 'Sin asignaciones' }}</p>
          <v-chip v-if="person.password_reset_at" size="small" color="warning" variant="tonal" class="mt-2">Cambio de contraseña pendiente</v-chip>
          <div class="mt-3"><v-btn v-if="canManage" size="small" color="primary" variant="tonal" :aria-label="`Restablecer contraseña de ${userDisplayName(person)}`" :loading="resetting.has(person.id)" :disabled="saving.has(person.id)" @click="askPasswordReset(person)">Restablecer contraseña</v-btn></div>
          <v-switch v-if="user.rol_usuario === 'superadmin'" :model-value="Boolean(person.activo)" :label="person.activo ? 'Activo' : 'Inactivo'" :aria-label="`Estado activo de ${userDisplayName(person)}`" :loading="saving.has(person.id)" :disabled="saving.has(person.id) || resetting.has(person.id)" color="primary" hide-details inset @update:model-value="requestActiveChange(person, $event)" />
        </v-list-item>
      </v-list>
      <v-sheet v-else border rounded="xl" class="pa-8 text-center">No hay usuarios registrados para mostrar.</v-sheet>
    </template>
    <v-dialog v-model="resetConfirmation" max-width="460" :persistent="resetting.size > 0" aria-labelledby="reset-confirm-title">
      <v-card rounded="xl">
        <v-card-title id="reset-confirm-title" class="wrap-text">Restablecer contraseña</v-card-title>
        <v-card-text>
          <p>¿Restablecer la contraseña de <strong>{{ passwordResetTarget ? userDisplayName(passwordResetTarget) : '' }}</strong>?</p>
          <p class="mt-3">Se usará su nombre y apellido en minúsculas como contraseña temporal. Sus sesiones se cerrarán y deberá cambiarla al iniciar sesión.</p>
          <v-alert v-if="error" type="error" variant="tonal" role="alert" class="mt-4">{{ error }}</v-alert>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn :disabled="resetting.size > 0" @click="resetConfirmation = false">Cancelar</v-btn>
          <v-spacer />
          <v-btn color="primary" :loading="resetting.size > 0" @click="confirmPasswordReset">Restablecer</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="deactivateConfirmation" max-width="460" :persistent="saving.size > 0" aria-labelledby="deactivate-confirm-title">
      <v-card rounded="xl">
        <v-card-title id="deactivate-confirm-title">Desactivar usuario</v-card-title>
        <v-card-text>
          <p>¿Desactivar a <strong>{{ deactivationTarget ? userDisplayName(deactivationTarget) : '' }}</strong>?</p>
          <p class="mt-3">Se cerrarán sus sesiones y no podrá iniciar sesión ni recibir nuevas asignaciones mientras esté inactivo.</p>
          <v-alert v-if="error" type="error" variant="tonal" role="alert" class="mt-4">{{ error }}</v-alert>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn :disabled="saving.size > 0" @click="deactivateConfirmation = false">Cancelar</v-btn>
          <v-spacer />
          <v-btn color="error" :loading="saving.size > 0" @click="confirmDeactivation">Desactivar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="dialog" max-width="460" scrollable aria-labelledby="calendar-title">
      <v-card rounded="xl">
        <v-card-title id="calendar-title">Buscar semanas</v-card-title>
        <v-card-text>
          <v-text-field v-model="calendarMonth" type="month" label="Mes y año" min="0001-01" max="9999-12" hide-details class="mb-4" />
          <p class="text-caption mb-4">Las fechas resaltadas pertenecen a semanas registradas. Selecciona una para ver sus roles.</p>
          <div class="calendar-grid">
            <span v-for="day in ['L', 'M', 'X', 'J', 'V', 'S', 'D']" :key="day" class="text-center text-caption">{{ day }}</span>
            <v-btn v-for="day in calendarDays" :key="day.date" :variant="day.available ? 'tonal' : 'text'" :color="day.available ? 'primary' : undefined" :disabled="!day.available || !day.inMonth" :aria-label="`${formatDate(day.date)}${day.available ? ', semana registrada' : ', sin registros'}`" class="calendar-day" @click="selectWeek(day)">{{ day.day }}</v-btn>
          </div>
        </v-card-text>
        <v-card-actions class="flex-wrap"><v-btn @click="dialog = false">Cancelar</v-btn><v-spacer /><v-btn color="primary" :disabled="!/^\d{4}-(0[1-9]|1[0-2])$/.test(calendarMonth)" @click="applyMonth">Ver mes</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.explore-page { display: flex; flex-direction: column; gap: 16px; justify-content: flex-start; align-content: start; padding: clamp(16px, 3vw, 32px); }
.explore-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.month-search { flex: 0 0 auto; }
.month-search :deep(input) { text-transform: capitalize; }
.explore-tabs { flex: 0 0 auto; background: #edf3f0; border-radius: 12px; }
.explore-tabs :deep(.v-tab) { text-transform: none; letter-spacing: 0; }
.wrap-text { white-space: normal; overflow-wrap: anywhere; -webkit-line-clamp: unset; }
.user-list { flex: 0 0 auto; align-content: start; display: grid; gap: 12px; padding: 0; overflow: visible; }
.user-item { padding: 16px; border: 1px solid #e4ebe7; background: white; }
.week-list { flex: 0 0 auto; display: grid; gap: 12px; padding: 0; overflow: visible; }
.week-item { border: 1px solid #e4ebe7; padding: 16px; background: white; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.calendar-day { min-width: 0; padding: 0; height: 40px; }
@media (min-width: 760px) { .user-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
