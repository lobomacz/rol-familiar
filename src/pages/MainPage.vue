<template>
  <v-container class="main-layout pa-0" fluid>
    <!-- Contenedor principal estilo móvil -->
    <div class="main-shell">
      
      <!-- Barra superior / Header -->
      <v-toolbar color="surface" flat density="comfortable" class="border-b px-2">
        <v-toolbar-title class="text-subtitle-1 font-weight-bold text-grey-darken-3 text-center">
          Rol Familiar
        </v-toolbar-title>
        <v-btn :aria-label="`${pendingCount} notas vencidas pendientes`" :disabled="pendingCount === 0 || !canCreateUsers" icon @click="openPendingNotes">
          <v-badge :content="pendingCount" :model-value="pendingCount > 0" color="error">
            <v-icon icon="mdi-bell" />
          </v-badge>
        </v-btn>
      </v-toolbar>

      <div class="page-content">
      <section v-if="bottomNav === 'roles'" class="roles-panel" aria-labelledby="roles-heading">
        <div class="roles-heading">
          <div>
            <p class="text-overline text-primary">Organización familiar</p>
            <h1 id="roles-heading" class="text-h5 font-weight-bold">{{ rolesHeading }}</h1>
            <p class="month-label text-body-2 text-medium-emphasis mt-1">{{ currentMonthYear || 'Calendario familiar' }}</p>
          </div>
          <v-btn v-if="activeTab === 'actual' && canCreateUsers" color="primary" variant="tonal" :disabled="loadingRoles || savingSwap || !!currentWeek.lock" @click="reorganizeDialog = true">Reorganizar</v-btn>
          <v-btn v-if="activeTab === 'actual' && canCreateUsers && !currentWeek.lock" color="primary" :disabled="loadingRoles || savingSwap" @click="lockDialog = true">Cerrar semana</v-btn>
          <p v-if="activeTab === 'actual' && currentWeek.lock" class="text-body-2" role="status">Semana cerrada · {{ currentWeek.lock.author }} · {{ new Date(currentWeek.lock.locked_at).toLocaleString('es-NI', { timeZone: 'America/Managua' }) }}</p>
          <v-btn v-if="activeTab === 'actual' && !currentWeek.lock" icon="mdi-refresh" color="primary" variant="tonal" aria-label="Actualizar asignaciones de la semana actual" title="Actualizar asignaciones" :loading="loadingRoles" :disabled="loadingRoles || savingSwap" @click="refreshCurrentWeek" />
          <v-chip color="primary" variant="tonal" size="small">{{ selectedRoles.length }} asignaciones</v-chip>
        </div>
        <v-tabs :model-value="activeTab" :disabled="loadingRoles || savingSwap" @update:model-value="changeWeekTab" color="primary" grow hide-slider height="56" class="week-tabs" aria-label="Seleccionar semana">
          <v-tab value="anterior" selected-class="week-tab-active">{{ previousTabLabel }}</v-tab>
          <v-tab value="actual" selected-class="week-tab-active">Semana actual</v-tab>
        </v-tabs>
        <v-alert v-if="error" type="error" variant="tonal" role="alert" rounded="lg">
          {{ error }} <v-btn variant="text" :disabled="loadingRoles" @click="loadRoles">Reintentar</v-btn>
        </v-alert>
        <v-sheet v-if="loadingRoles" class="state-panel" rounded="xl" border role="status" aria-live="polite">
          <v-progress-circular indeterminate color="primary" aria-label="Cargando roles" />
          <p class="text-body-2 text-medium-emphasis mt-4">Preparando las asignaciones de la semana…</p>
        </v-sheet>
        <v-sheet v-else-if="!selectedRoles.length && !error" class="state-panel" rounded="xl" border role="status">
          <v-avatar color="primary" variant="tonal" size="64"><v-icon icon="mdi-account" size="32" /></v-avatar>
          <h2 class="text-subtitle-1 font-weight-bold mt-4">{{ activeTab === 'anterior' ? 'Semana anterior' : currentWeek.generationBlocked ? 'Se necesitan más participantes' : 'Una semana por organizar' }}</h2>
          <p class="text-body-2 text-medium-emphasis mt-2">{{ activeTab === 'anterior' ? 'No se genero un rol para esta semana.' : currentWeek.generationBlocked === 'INSUFFICIENT_ACTIVE_USERS' ? 'Se necesitan al menos dos usuarios activos con rol usuario o admin para crear las asignaciones de la semana.' : 'No hay roles asignados para esta semana.' }}</p>
        </v-sheet>
        <v-list v-else-if="!loadingRoles && selectedRoles.length" :key="activeTab" class="role-list" bg-color="transparent" aria-label="Asignaciones de la semana">
          <v-list-item v-for="item in selectedRoles" :key="item.id" class="role-item" rounded="lg" :class="{ 'role-item-switched': item.rol_switched }">
            <template #prepend>
              <div class="date-tile" aria-hidden="true">
                <span>{{ shortDay(item.date) }}</span><strong>{{ dayNumber(item.date) }}</strong>
              </div>
            </template>
            <v-list-item-title class="role-date">{{ item.rol_switched ? item.replacement_name : item.assigned_name }}</v-list-item-title>
            <v-list-item-subtitle v-if="item.rol_switched" class="role-person">En sustitucion de {{ item.assigned_name }}</v-list-item-subtitle>
            <template #append>
              <v-btn v-if="activeTab === 'actual' && user.rol_usuario === 'superadmin'" icon="mdi-account-edit" variant="text" color="primary" :aria-label="`Cambiar usuario asignado al ${item.date}`" :disabled="savingSwap" @click="openAssignment(item)" />
              <v-btn icon variant="text" :color="dayNoteCount(item.date) ? 'blue' : undefined" :disabled="!dayNoteCount(item.date) || savingSwap" :aria-label="`Notas del ${item.date}: ${dayNoteCount(item.date)}`" @click="openDayNotes(item)">
                <v-badge :model-value="dayNoteCount(item.date) > 0" color="red" location="top left" dot floating><v-icon icon="mdi-square-edit-outline" :color="dayNoteCount(item.date) > 0 ? 'blue' : undefined" /></v-badge>
              </v-btn>
              <v-switch class="replacement-switch ml-3" label="Cambiar" :model-value="Boolean(item.rol_switched)" :disabled="!canSwitch(item) || savingSwap || loadingRoles" :loading="savingRoleId === item.id" color="primary" inset hide-details density="compact" :aria-label="`Sustituir la asignación del ${item.date} de ${item.assigned_name}`" @update:model-value="toggleReplacement(item, $event)" />
            </template>
          </v-list-item>
        </v-list>
      </section>

      <Explore v-if="bottomNav === 'explorar'" :user="user" :initial-tab="initialExploreTab" @open-week="openWeek" @new-user="emit('new-user', 'explorar')" @unauthorized="emit('unauthorized')" />
      <Notas :key="notesRevision" v-if="bottomNav === 'notas'" :user="user" :overdue-only="pendingOnly" @show-all="pendingOnly = false" @changed="loadPendingNotes" @unauthorized="emit('unauthorized')" />
      <v-card v-if="bottomNav === 'perfil'" flat class="pa-6" title="Perfil">
        <v-card-text>
          <p>{{ userDisplayName(user) }}</p>
          <p>Rol: {{ user.rol_usuario }}</p>
        </v-card-text>
        <v-alert v-if="passwordSuccess" type="success" variant="tonal" role="status" class="mb-4">Contraseña actualizada correctamente.</v-alert>
        <div class="profile-actions">
        <v-btn color="primary" variant="tonal" class="responsive-action" @click="openPasswordDialog">Cambiar contrasena</v-btn>
        <v-btn v-if="canCreateUsers" color="primary" class="responsive-action" @click="$emit('new-user')">Nuevo usuario</v-btn>
        <v-btn color="primary" class="responsive-action" :loading="loggingOut" @click="$emit('logout')">Cerrar sesión</v-btn>
        </div>
      </v-card>
      </div>
      <!-- Barra de Navegación Inferior (Bottom Navigation) -->
      <nav class="bottom-nav border-t" aria-label="Navegación principal">
        <v-btn v-for="item in navigation" :key="item.value" :value="item.value"
          variant="text" :color="bottomNav === item.value ? 'primary' : undefined"
          :aria-current="bottomNav === item.value ? 'page' : undefined"
          @click="bottomNav = item.value" class="nav-button">
          <span class="nav-content"><v-icon :icon="item.icon" /><span>{{ item.label }}</span></span>
        </v-btn>
      </nav>

    </div>
    <v-dialog v-model="reorganizeDialog" max-width="480" :persistent="savingSwap" aria-labelledby="reorganize-title">
      <v-card rounded="xl">
        <v-card-title id="reorganize-title">Reorganizar semana actual</v-card-title>
        <v-card-text>Se generará una distribución diferente para toda la semana actual. Se reemplazarán las asignaciones manuales y se cancelarán los intercambios. Las notas se conservarán en sus fechas.</v-card-text>
        <v-card-actions><v-btn :disabled="savingSwap" @click="reorganizeDialog = false">Cancelar</v-btn><v-spacer /><v-btn color="primary" :loading="savingSwap" @click="reorganize">Reorganizar</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
    <AssignmentDialog v-if="user.rol_usuario === 'superadmin'" v-model="assignmentDialog" :role="assignmentRole" @saved="assignmentSaved" @unauthorized="emit('unauthorized')" />
    <v-dialog v-model="replacementDialog" max-width="480" :persistent="savingSwap" scrollable aria-labelledby="replacement-title" @after-leave="resetReplacement">
      <v-card rounded="xl">
        <v-card-title id="replacement-title">Seleccionar sustituto</v-card-title>
        <v-card-text>
          <p class="text-body-2 mb-4" aria-live="polite">Selecciona quién cubrirá la asignación.<template v-if="replacementDays.length > 1"> Selecciona también el día que cubrirá el usuario originalmente asignado a cambio.</template> Ambos quedarán reservados para este intercambio durante la semana.</p>
          <v-alert v-if="swapError" type="error" variant="tonal" role="alert" class="mb-4">{{ swapError }}</v-alert>
          <v-form id="replacement-form" :disabled="savingSwap || loadingReplacements" @submit.prevent="confirmReplacement">
            <v-select v-model="selectedReplacement" :items="replacementUsers" :item-title="userDisplayName" item-value="id" label="Sustituto" :loading="loadingReplacements" :disabled="loadingReplacements || !replacementUsers.length" :error-messages="replacementValidation.selectedReplacement.$errors.map(e => e.$message)" @blur="replacementValidation.selectedReplacement.$touch()" no-data-text="No hay sustitutos disponibles" />
            <v-select v-if="replacementDays.length > 1" v-model="selectedReplacementDay" :items="replacementDays" :item-title="day => `${shortDay(day.date)} · ${formatWeekDate(day.date)}`" item-value="id" label="Día a cubrir del sustituto" :error-messages="replacementValidation.selectedReplacementDay.$errors.map(e => e.$message)" @blur="replacementValidation.selectedReplacementDay.$touch()" />
            <p v-else-if="replacementDays.length === 1" class="text-body-2 mb-4">El usuario originalmente asignado cubrirá el {{ shortDay(replacementDays[0].date) }} {{ formatWeekDate(replacementDays[0].date) }}.</p>
            <p v-else-if="selectedReplacement" class="text-body-2 mb-4">Este sustituto no tiene días asignados para intercambiar.</p>
            <p v-if="!loadingReplacements && !replacementUsers.length && !swapError" class="text-body-2" role="status">No hay usuarios disponibles. Los participantes de una sustitución pendiente no pueden iniciar otro intercambio.</p>
          </v-form>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn :disabled="savingSwap" @click="replacementDialog = false">Cancelar</v-btn>
          <v-spacer />
          <v-btn type="submit" form="replacement-form" color="primary" :loading="savingSwap" :disabled="loadingReplacements || !replacementUsers.length">Aceptar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <PendingNotesDialog v-if="canCreateUsers" v-model="pendingDialog" @changed="notificationsChanged" @unauthorized="emit('unauthorized')" />
    <DayNotesDialog v-model="dayNotesDialog" :date="notesDate" @changed="loadPendingNotes" @unauthorized="emit('unauthorized')" />
    <PasswordChangeDialog v-model="passwordDialog" @saved="passwordSuccess = true" @unauthorized="emit('unauthorized')" />
  </v-container>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Notas from './Notas.vue'
import DayNotesDialog from '../components/DayNotesDialog.vue'
import PendingNotesDialog from '../components/PendingNotesDialog.vue'
import AssignmentDialog from '../components/AssignmentDialog.vue'
import Explore from './Explore.vue'
import { useReplacementValidation } from '../helpers/replacement-validation.js'
import { userDisplayName } from '../helpers/user-display.js'
import PasswordChangeDialog from '../components/PasswordChangeDialog.vue'
const props = defineProps({ user: { type: Object, required: true }, loggingOut: Boolean, initialTab: String, initialExploreTab: String })
const emit = defineEmits(['logout', 'new-user', 'unauthorized'])
const canCreateUsers = computed(() => ['admin', 'superadmin'].includes(props.user.rol_usuario))
const reorganizeDialog = ref(false)
const assignmentDialog = ref(false), assignmentRole = ref(null)
function openAssignment(item) { assignmentRole.value = item; assignmentDialog.value = true }
function assignmentSaved(week) { currentWeek.value = week; notesRevision.value++; loadPendingNotes() }
const dayNotesDialog = ref(false), notesDate = ref('')
function openDayNotes(item) { notesDate.value = item.date; dayNotesDialog.value = true }
const pendingCount = ref(0), pendingOnly = ref(false), dayNotes = ref([])
const notesByDate = computed(() => {
  const counts = new Map()
  for (const note of dayNotes.value) counts.set(note.date, (counts.get(note.date) || 0) + 1)
  return counts
})
const dayNoteCount = date => notesByDate.value.get(date) || 0
let notificationTimer
const pendingDialog = ref(false), notesRevision = ref(0)
function openPendingNotes() { if (pendingCount.value > 0 && canCreateUsers.value) pendingDialog.value = true }
function notificationsChanged() { notesRevision.value++; loadPendingNotes() }
async function loadPendingNotes() {
  try { const data = await request('/api/notes'); pendingCount.value = data.pendingCount; dayNotes.value = data.notes } catch { /* The page displays request errors; polling retries automatically. */ }
}
onMounted(() => { loadPendingNotes(); notificationTimer = setInterval(loadPendingNotes, 60000) })
onBeforeUnmount(() => clearInterval(notificationTimer))
const passwordDialog = ref(false), passwordSuccess = ref(false)
function openPasswordDialog() { passwordSuccess.value = false; passwordDialog.value = true }
const navigation = [
  { value: 'explorar', label: 'Explorar', icon: 'mdi-compass-outline' },
  { value: 'roles', label: 'Roles', icon: 'mdi-menu' },
  { value: 'notas', label: 'Notas', icon: 'mdi-square-edit-outline' },
  { value: 'perfil', label: 'Perfil', icon: 'mdi-account-outline' },
]

// Estado para pestañas y navegación
const activeTab = ref('actual')
const bottomNav = ref(props.initialTab || 'roles')
const currentWeek = ref({ roles: [] }), previousWeek = ref({ roles: [] }), exploredWeek = ref(null)
const loadingRoles = ref(true), error = ref('')
const currentWeekRoles = computed(() => currentWeek.value.roles)
const previousWeekRoles = computed(() => (exploredWeek.value || previousWeek.value).roles)
const selectedRoles = computed(() => activeTab.value === 'actual' ? currentWeekRoles.value : previousWeekRoles.value)
const rolesHeading = computed(() => {
  const week = activeTab.value === 'actual' ? currentWeek.value : exploredWeek.value || previousWeek.value
  if (!week.start || !week.end) return 'Rol de la semana'
  const formatDate = date => {
    const parts = new Intl.DateTimeFormat('es-NI', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }).formatToParts(new Date(`${date}T12:00:00Z`))
    const part = name => parts.find(item => item.type === name).value
    const weekday = part('weekday')
    const month = part('month')
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${part('day')} de ${month.charAt(0).toUpperCase()}${month.slice(1)}`
  }
  return `Semana del ${formatDate(week.start)} al ${formatDate(week.end)}`
})
const currentMonthYear = computed(() => {
  const start = (activeTab.value === 'actual' ? currentWeek.value : exploredWeek.value || previousWeek.value).start
  return start ? new Intl.DateTimeFormat('es-NI', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${start}T12:00:00Z`)) : ''
})
const shortDay = date => new Intl.DateTimeFormat('es-NI', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
const dayNumber = date => Number(date.slice(-2))
const formatWeekDate = date => new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
const previousTabLabel = computed(() => exploredWeek.value ? `Semana del ${formatWeekDate(exploredWeek.value.start)} al ${formatWeekDate(exploredWeek.value.end)}` : 'Semana anterior')
const replacementDialog = ref(false), loadingReplacements = ref(false), savingSwap = ref(false), savingRoleId = ref(null)
const replacementRole = ref(null), selectedReplacement = ref(null), replacementUsers = ref([]), swapError = ref('')
const selectedReplacementDay = ref(null)
const replacementDays = computed(() => replacementUsers.value.find(user => user.id === selectedReplacement.value)?.days || [])
watch(selectedReplacement, () => {
  selectedReplacementDay.value = replacementDays.value.length === 1 ? replacementDays.value[0].id : null
  replacementValidation.value.selectedReplacementDay.$reset()
})
const replacementValidation = useReplacementValidation(selectedReplacement, selectedReplacementDay, replacementDays)
const canSwitch = item => activeTab.value === 'actual' && (props.user.rol_usuario === 'superadmin' || item.assigned_user === props.user.id) && item.date >= currentWeek.value.start && item.date <= currentWeek.value.end
function changeWeekTab(value) {
  exploredWeek.value = null
  activeTab.value = value
  replacementDialog.value = false
}
watch(bottomNav, (value, previous) => {
  if (value !== 'notas') pendingOnly.value = false
  if (previous === 'roles' && value !== 'roles') { exploredWeek.value = null; replacementDialog.value = false; weekRequest++; loadingRoles.value = false }
})
let weekRequest = 0
async function openWeek(start) {
  const requestId = ++weekRequest
  bottomNav.value = 'roles'; loadingRoles.value = true; error.value = ''
  try {
    const week = await request(`/api/roles?start=${encodeURIComponent(start)}`)
    if (requestId !== weekRequest || bottomNav.value !== 'roles') return
    if (week.isCurrentWeek) {
      currentWeek.value = week; exploredWeek.value = null; activeTab.value = 'actual'
    } else { exploredWeek.value = week; activeTab.value = 'anterior' }
  } catch (err) { if (requestId === weekRequest) error.value = err.message }
  finally { if (requestId === weekRequest) loadingRoles.value = false }
}
let replacementRequest = 0
function resetReplacement() {
  replacementRequest++; loadingReplacements.value = false
  replacementRole.value = null; selectedReplacement.value = null; selectedReplacementDay.value = null; replacementUsers.value = []; swapError.value = ''
  replacementValidation.value.$reset()
}
async function toggleReplacement(item, enabled) {
  if (!canSwitch(item) || savingSwap.value) return
  if (!enabled) {
    savingSwap.value = true; savingRoleId.value = item.id; error.value = ''
    try { currentWeek.value = await request(`/api/roles/${item.id}/switch`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rol_switched: false, expected_replace_user: item.replace_user }) }) }
    catch (err) { error.value = err.message }
    finally { savingSwap.value = false; savingRoleId.value = null }
    return
  }
  resetReplacement(); replacementRole.value = item; replacementDialog.value = true; loadingReplacements.value = true
  const requestId = ++replacementRequest
  try {
    const data = await request(`/api/roles/${item.id}/replacements`)
    if (requestId === replacementRequest && replacementDialog.value && replacementRole.value?.id === item.id) replacementUsers.value = data.users
  } catch (err) { if (requestId === replacementRequest && replacementDialog.value && replacementRole.value?.id === item.id) swapError.value = err.message }
  finally { if (requestId === replacementRequest) loadingReplacements.value = false }
}
async function confirmReplacement() {
  if (savingSwap.value || loadingReplacements.value || !replacementRole.value || !(await replacementValidation.value.$validate())) return
  savingSwap.value = true; savingRoleId.value = replacementRole.value.id; swapError.value = ''
  try {
    currentWeek.value = await request(`/api/roles/${replacementRole.value.id}/switch`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rol_switched: true, replace_user: selectedReplacement.value, replace_role_id: selectedReplacementDay.value }) })
    replacementDialog.value = false
  } catch (err) { swapError.value = err.message }
  finally { savingSwap.value = false; savingRoleId.value = null }
}
async function request(url, options) {
  const response = await fetch(url, options)
  if (response.status === 401) { emit('unauthorized'); throw new Error('La sesión ha vencido') }
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los roles')
  return data
}
async function reorganize() {
  if (savingSwap.value || loadingRoles.value) return
  savingSwap.value = true; error.value = ''
  try {
    currentWeek.value = await request('/api/roles/reorganize', { method: 'POST' })
    notesRevision.value++; await loadPendingNotes()
  } catch (err) { error.value = err.message }
  finally { savingSwap.value = false; reorganizeDialog.value = false }
}
async function refreshCurrentWeek() {
  if (activeTab.value !== 'actual' || currentWeek.value.lock || loadingRoles.value || savingSwap.value) return
  const requestId = ++weekRequest
  loadingRoles.value = true; error.value = ''
  try {
    const week = await request('/api/roles')
    if (requestId !== weekRequest || bottomNav.value !== 'roles') return
    currentWeek.value = week
    await loadPendingNotes()
  } catch (err) { if (requestId === weekRequest) error.value = err.message }
  finally { if (requestId === weekRequest) loadingRoles.value = false }
}
async function loadRoles() {
  loadingRoles.value = true; error.value = ''
  try {
    currentWeek.value = await request('/api/roles/ensure-current', { method: 'POST' })
    previousWeek.value = await request('/api/roles?week=previous')
  } catch (err) { error.value = err.message }
  finally { loadingRoles.value = false }
}
onMounted(loadRoles)
</script>

<style scoped>
.profile-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
@media (min-width: 760px) { .profile-actions { flex-direction: row; flex-wrap: wrap; } }
.main-layout { padding: clamp(0px, 2vh, 24px) !important; padding: clamp(0px, 2dvh, 24px) !important; }
.main-shell { max-width: 960px; margin: auto; height: calc(100vh - clamp(0px, 2vh, 24px) * 2); height: calc(100dvh - clamp(0px, 2dvh, 24px) * 2); display: flex; flex-direction: column; overflow: hidden; background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-border-color), .1); border-radius: 24px; box-shadow: 0 12px 40px #173d3010; }
.main-shell > .v-toolbar { flex: 0 0 auto; padding-top: env(safe-area-inset-top); }
.page-content { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; }
.roles-panel { min-height: 100%; display: flex; flex-direction: column; gap: 20px; padding: clamp(16px, 3vw, 32px); }
.roles-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.month-label::first-letter { text-transform: uppercase; }
.week-tabs { flex: 0 0 auto; background: #edf3f0; border-radius: 14px; padding: 4px; }
.week-tabs :deep(.v-tab) { min-width: 0; min-height: 48px; text-transform: none; letter-spacing: 0; border-radius: 10px; font-weight: 600; flex: 1; white-space: normal; line-height: 1.3; }
.week-tabs :deep(.v-btn__content) { white-space: normal; }
.week-tabs :deep(.week-tab-active) { background: rgb(var(--v-theme-surface)); box-shadow: 0 2px 6px #173d3015; }
.role-list { display: grid; gap: 10px; padding: 0; overflow: visible; flex: 1; align-content: start; }
.role-item { grid-template-areas: "prepend content" "prepend append"; grid-template-columns: max-content minmax(0, 1fr); background: #fff; border: 1px solid #e4ebe7; min-height: 88px; padding: 14px 16px; }
.role-item-switched { border-color: #adc7bb; background: #f7fbf9; }
.date-tile { width: 52px; min-height: 60px; margin-right: 16px; border-radius: 12px; background: #edf3f0; color: rgb(var(--v-theme-primary)); display: flex; flex-direction: column; align-items: center; justify-content: center; }
.date-tile span { font-size: 11px; text-transform: uppercase; font-weight: 600; }
.date-tile strong { font-size: 24px; line-height: 1.2; }
.role-item :deep(.v-list-item__append) { grid-area: append; justify-self: end; justify-content: flex-end; flex-wrap: wrap; gap: 2px; margin-top: 6px; }
.replacement-switch { flex: 0 0 auto; }
.replacement-switch :deep(.v-selection-control) { flex-direction: column-reverse; align-items: center; }
.replacement-switch :deep(.v-label) { width: calc(52px * var(--v-switch-scale, 1)); height: auto; justify-content: center; margin: 0 0 6px; padding: 0; font-family: inherit; font-size: 10px; font-weight: 500; letter-spacing: 0; line-height: 1.2; text-align: center; white-space: nowrap; }
.role-date { font-size: 14px; font-weight: 700; white-space: normal; }
.role-date::first-letter { text-transform: uppercase; }
.role-person { margin-top: 5px; font-size: 14px; line-height: 1.5; white-space: normal; opacity: .8; -webkit-line-clamp: unset; overflow: visible; overflow-wrap: anywhere; }
.state-panel { flex: 1; min-height: 200px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; text-align: center; }
.bottom-nav { display: flex; flex: 0 0 auto; gap: 4px; padding: 8px 12px calc(8px + env(safe-area-inset-bottom)); background: white; }
.nav-button { flex: 1; min-width: 0; height: 60px; border-radius: 12px; }
.nav-button[aria-current="page"] { background: #edf3f0; }
.nav-content { display: flex; flex-direction: column; align-items: center; gap: 5px; font-size: 12px; text-transform: none; letter-spacing: 0; }
@media (min-width: 760px) { .role-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 599px) {
  .main-layout { padding: 0 !important; }
  .main-shell { height: 100vh; height: 100dvh; border: 0; border-radius: 0; }
  .roles-panel { gap: 16px; }
  .bottom-nav { padding-inline: max(8px, env(safe-area-inset-left)) max(8px, env(safe-area-inset-right)); }
}
@media (max-height: 600px) { .roles-panel { gap: 12px; } .role-item { min-height: 76px; } .nav-button { height: 48px; } }
</style>
