<script setup>
import { computed, ref, watch } from 'vue'
const props = defineProps({ modelValue: Boolean, date: { type: String, default: '' }, noteId: { type: Number, default: null } })
const emit = defineEmits(['update:modelValue', 'changed', 'unauthorized'])
const notes = ref([]), loading = ref(false), saving = ref(null), error = ref('')
const title = computed(() => props.date ? new Intl.DateTimeFormat('es-NI', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${props.date}T12:00:00Z`)) : '')
const priorities = { normal: 'Normal', atencion: 'Atención', critical: 'Crítica' }
let requestId = 0
async function request(url, options) {
  const response = await fetch(url, options)
  if (response.status === 401) emit('unauthorized')
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las notas')
  return data
}
async function load() {
  const id = ++requestId, date = props.date
  loading.value = true; error.value = ''; notes.value = []
  try {
    const data = await request('/api/notes')
    if (id === requestId) notes.value = data.notes.filter(note => note.date === date && (props.noteId === null || note.id === props.noteId))
  } catch (err) { if (id === requestId) error.value = err.message }
  finally { if (id === requestId) loading.value = false }
}
async function removeNote(note) {
  if (!note.canDelete || !window.confirm('¿Eliminar esta nota?')) return
  saving.value = note.id; error.value = ''
  try {
    await request(`/api/notes/${note.id}`, { method: 'DELETE' })
    emit('changed'); await load()
  } catch (err) { error.value = err.message }
  finally { saving.value = null }
}
async function complete(note) {
  if (saving.value !== null || !note.canComplete) return
  saving.value = note.id; error.value = ''
  try {
    await request(`/api/notes/${note.id}/complete`, { method: 'POST' })
    emit('changed')
    await load()
  } catch (err) { error.value = err.message }
  finally { saving.value = null }
}
watch(() => [props.modelValue, props.date, props.noteId], ([open]) => {
  if (open) load()
  else { requestId++; notes.value = []; error.value = ''; loading.value = false }
})
</script>

<template>
  <v-dialog :model-value="modelValue" :persistent="saving !== null" max-width="600" scrollable aria-labelledby="day-notes-title" @update:model-value="emit('update:modelValue', $event)">
    <v-card rounded="xl">
      <v-card-title id="day-notes-title" class="dialog-title">Notas · {{ title }}</v-card-title>
      <v-card-text>
        <v-alert v-if="error" type="error" variant="tonal" role="alert" class="mb-4">
          {{ error }} <v-btn variant="text" :disabled="loading || saving !== null" @click="load">Reintentar</v-btn>
        </v-alert>
        <v-progress-linear v-if="loading" indeterminate aria-label="Cargando notas del día" />
        <p v-else-if="!notes.length && !error" role="status">No hay notas para este día.</p>
        <ul v-else class="day-notes-list">
          <li v-for="note in notes" :key="note.id" class="day-note" :class="{ completed: note.completed_at }">
            <div class="note-heading">
              <strong>Nota #{{ note.id }}</strong>
              <v-chip size="small" :color="note.priority === 'critical' ? 'red' : note.priority === 'atencion' ? 'amber-darken-3' : 'grey'">
                <v-icon v-if="note.priority !== 'normal'" icon="mdi-alert" start />{{ priorities[note.priority] }}
              </v-chip>
            </div>
            <p v-if="note.parent_id" class="text-body-2 mt-2">Derivada de nota #{{ note.parent_id }}</p>
            <div v-for="entry in note.entries" :key="entry.id" class="my-3">
              <p class="note-text">{{ entry.text }}</p>
              <small>{{ entry.author_name }} · {{ new Date(entry.created_at).toLocaleString('es-NI', { timeZone: 'America/Managua' }) }}</small>
            </div>
            <p v-if="note.completed_at" class="text-body-2">Completada</p>
            <v-btn v-if="note.canDelete" size="small" color="error" variant="text" :disabled="saving !== null || loading" @click="removeNote(note)">Eliminar nota</v-btn>
            <template v-if="!note.completed_at">
              <p v-if="note.overdue" class="text-body-2 text-error mb-2">Nota vencida: requiere un administrador.</p>
              <v-btn v-if="note.canComplete" color="primary" size="small" :loading="saving === note.id" :disabled="saving !== null || loading" @click="complete(note)">{{ note.overdue ? 'Completar y limpiar aviso' : 'Completar' }}</v-btn>
              <p v-else-if="!note.overdue" class="text-body-2 text-medium-emphasis">Solo el usuario asignado o su sustituto puede completar esta nota.</p>
            </template>
          </li>
        </ul>
      </v-card-text>
      <v-card-actions><v-spacer /><v-btn :disabled="saving !== null" @click="emit('update:modelValue', false)">Cerrar</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.dialog-title { white-space: normal; }
.day-notes-list { display: grid; gap: 16px; list-style: none; padding: 0; }
.day-note { border: 1px solid #dfe7e2; border-radius: 12px; padding: 16px; min-width: 0; }
.note-heading { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.note-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.completed { color: #757575; background: #f3f3f3; }
.completed .note-text { text-decoration: line-through; }
</style>
