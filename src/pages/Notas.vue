<script setup>
import { computed, onMounted, ref } from 'vue'
const props = defineProps({ user: { type: Object, required: true }, overdueOnly: Boolean })
const emit = defineEmits(['unauthorized', 'changed', 'show-all'])
const notes = ref([]), days = ref([]), loading = ref(false), saving = ref(false), error = ref('')
const date = ref(''), text = ref(''), priority = ref('normal'), parent = ref(null), appendTarget = ref(null)
const priorities = [{ title: 'Normal', value: 'normal' }, { title: 'Atención', value: 'atencion' }, { title: 'Crítica', value: 'critical' }]
const visible = computed(() => props.overdueOnly ? notes.value.filter(note => note.overdue) : notes.value)
const formatDate = value => new Intl.DateTimeFormat('es-NI', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
async function request(url, options) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    if (response.status === 401) emit('unauthorized')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar la nota')
    return data
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('La conexión tardó demasiado. Intente de nuevo.')
    throw err
  } finally { clearTimeout(timeout) }
}
async function load() {
  loading.value = true; error.value = ''
  try {
    const week = await request('/api/roles/ensure-current', { method: 'POST' })
    const [data, history] = await Promise.all([request('/api/notes'), request('/api/roles/history')])
    notes.value = data.notes
    const roles = [...new Map([...history.roles, ...week.roles].map(role => [role.date, role])).values()].sort((a, b) => b.date.localeCompare(a.date))
    days.value = roles.map(role => ({ title: `${formatDate(role.date)} · ${role.rol_switched ? role.replacement_name : role.assigned_name}`, value: role.date }))
    if (!date.value) date.value = week.roles.find(role => role.date === data.today)?.date || week.roles[0]?.date || days.value[0]?.value || ''
    emit('changed')
  } catch (err) { error.value = err.message }
  finally { loading.value = false }
}
function cancel() { appendTarget.value = null; parent.value = null; text.value = ''; priority.value = 'normal' }
function edit(note, derived) {
  cancel(); date.value = note.date
  if (derived) parent.value = note.id
  else appendTarget.value = note.id
  document.getElementById('note-form')?.scrollIntoView({ behavior: 'smooth' })
}
async function save() {
  if (saving.value || loading.value || !text.value.trim() || (!appendTarget.value && !date.value)) return
  saving.value = true; error.value = ''
  try {
    await request(appendTarget.value ? `/api/notes/${appendTarget.value}/entries` : '/api/notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.value, date: date.value, priority: priority.value, parent_id: parent.value }),
    })
    cancel(); await load()
  } catch (err) { error.value = err.message }
  finally { saving.value = false }
}
async function removeNote(note) {
  if (!note.canDelete || !window.confirm('¿Eliminar esta nota?')) return
  saving.value = true; error.value = ''
  try {
    await request(`/api/notes/${note.id}`, { method: 'DELETE' })
    emit('changed'); await load()
  } catch (err) { error.value = err.message }
  finally { saving.value = false }
}
async function complete(note) {
  saving.value = true; error.value = ''
  try {
    await request(`/api/notes/${note.id}/complete`, { method: 'POST' })
    if (appendTarget.value === note.id || parent.value === note.id) cancel()
    await load()
  } catch (err) { error.value = err.message }
  finally { saving.value = false }
}
onMounted(load)
</script>

<template>
  <section class="notes-panel" aria-labelledby="notes-title">
    <h1 id="notes-title" class="text-h5 font-weight-bold">Notas</h1>
    <p class="text-body-2 text-medium-emphasis">Agregue notas a los días asignados. El texto se conserva; las notas completas quedan bloqueadas. Las notas de días anteriores solo las puede completar un administrador.</p>
    <v-alert v-if="error" type="error" role="alert">{{ error }} <v-btn :disabled="loading || saving" @click="load">Reintentar</v-btn></v-alert>
    <v-form id="note-form" :disabled="saving" @submit.prevent="save">
      <h2 class="text-subtitle-1 mb-3">{{ appendTarget ? `Agregar texto a nota #${appendTarget}` : parent ? `Crear nota derivada de #${parent}` : 'Nueva nota' }}</h2>
      <v-select v-if="!appendTarget" v-model="date" :items="days" :loading="loading" label="Día y responsable" no-data-text="No hay días asignados" />
      <v-select v-if="!appendTarget" v-model="priority" :items="priorities" label="Prioridad" />
      <v-textarea v-model="text" class="note-input" label="Texto de la nota" variant="outlined" color="primary" rounded="lg" maxlength="4000" counter auto-grow rows="3" required />
      <div class="note-actions">
        <v-btn type="submit" color="primary" :loading="saving" :disabled="loading || !text.trim() || (!appendTarget && !date)">{{ appendTarget ? 'Agregar texto' : 'Crear nota' }}</v-btn>
        <v-btn v-if="appendTarget || parent" :disabled="saving" @click="cancel">Cancelar</v-btn>
      </div>
    </v-form>
    <div class="note-actions">
      <h2 class="text-h6">{{ overdueOnly ? 'Notas vencidas pendientes' : 'Todas las notas' }}</h2>
      <v-btn v-if="overdueOnly" variant="text" @click="emit('show-all')">Ver todas</v-btn>
    </div>
    <v-progress-linear v-if="loading" indeterminate aria-label="Cargando notas" />
    <p v-else-if="!visible.length" role="status">No hay notas {{ overdueOnly ? 'vencidas pendientes' : 'disponibles' }}.</p>
    <ul class="notes-list">
      <li v-for="note in visible" :key="note.id" :id="`note-${note.id}`" class="note-card" :class="{ completed: note.completed_at }">
        <div class="note-actions">
          <strong>#{{ note.id }} · {{ formatDate(note.date) }}</strong>
          <v-chip size="small" :color="note.priority === 'critical' ? 'red-darken-2' : note.priority === 'atencion' ? 'amber-darken-3' : 'grey'">
            <v-icon v-if="note.priority !== 'normal'" icon="mdi-alert" :color="note.priority === 'critical' ? 'red' : 'amber'" start />
            {{ priorities.find(p => p.value === note.priority)?.title }}
          </v-chip>
        </div>
        <p class="text-body-2">Responsable: {{ note.assigned_name }}</p>
        <a v-if="note.parent_id" :href="`#note-${note.parent_id}`">Derivada de nota #{{ note.parent_id }}</a>
        <div v-for="entry in note.entries" :key="entry.id" class="note-entry">
          <p class="note-text">{{ entry.text }}</p>
          <small>{{ entry.author_name }} · {{ new Date(entry.created_at).toLocaleString('es-NI', { timeZone: 'America/Managua' }) }}</small>
        </div>
        <p v-if="note.completed_at" class="text-body-2">Completada · {{ new Date(note.completed_at).toLocaleString('es-NI', { timeZone: 'America/Managua' }) }}</p>
        <p v-if="note.overdue" class="text-body-2 text-error">Pendiente de un día anterior · requiere administrador</p>
          <div class="note-actions mt-3">
            <v-btn v-if="!note.completed_at" size="small" variant="tonal" :disabled="saving" @click="edit(note, false)">Agregar texto</v-btn>
            <v-btn v-if="note.completed_at" size="small" variant="tonal" :disabled="saving" @click="edit(note, true)">Derivar nota</v-btn>
            <v-btn v-if="note.canDelete" size="small" color="error" variant="text" :disabled="saving || loading" @click="removeNote(note)">Eliminar nota</v-btn>
              <v-btn v-if="note.canComplete" size="small" color="primary" :disabled="saving" @click="complete(note)">{{ note.overdue ? 'Completar y limpiar aviso' : 'Completar' }}</v-btn>
          </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.notes-panel { display: grid; gap: 20px; padding: clamp(16px, 3vw, 32px); }
.notes-panel > *, #note-form { min-width: 0; }
.note-input :deep(textarea) { font-size: 16px; user-select: text; -webkit-user-select: text; -webkit-touch-callout: default; }
.notes-list { list-style: none; padding: 0; display: grid; gap: 16px; }
.note-card { border: 1px solid #dfe7e2; border-radius: 16px; padding: 18px; min-width: 0; }
.note-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
.note-entry { margin-block: 14px; }
.note-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.completed { color: #757575; background: #f3f3f3; }
.completed .note-text { text-decoration: line-through; }
</style>
