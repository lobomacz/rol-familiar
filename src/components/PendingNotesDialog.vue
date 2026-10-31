<script setup>
import { ref, watch } from 'vue'
import DayNotesDialog from './DayNotesDialog.vue'
const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'changed', 'unauthorized'])
const notes = ref([]), loading = ref(false), clearing = ref(false), error = ref('')
const detailOpen = ref(false), detailDate = ref(''), detailId = ref(null)
let requestId = 0
const formatDate = date => new Intl.DateTimeFormat('es-NI', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
const priorities = { normal: 'Normal', atencion: 'Atención', critical: 'Crítica' }
async function request(url, options) {
  const response = await fetch(url, options)
  if (response.status === 401) emit('unauthorized')
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las notificaciones')
  return data
}
async function load() {
  const id = ++requestId
  loading.value = true; error.value = ''
  try {
    const data = await request('/api/notes')
    if (id === requestId) notes.value = data.notes.filter(note => note.overdue)
  } catch (err) { if (id === requestId) error.value = err.message }
  finally { if (id === requestId) loading.value = false }
}
function openDetail(note) { detailDate.value = note.date; detailId.value = note.id; detailOpen.value = true }
async function changed() { emit('changed'); await load() }
async function clearAll() {
  if (clearing.value || loading.value || !notes.value.length) return
  clearing.value = true; error.value = ''
  try {
    await request('/api/notes/clear-pending', { method: 'POST' })
    await changed()
  } catch (err) { error.value = err.message }
  finally { clearing.value = false }
}
watch(() => props.modelValue, open => {
  if (open) { notes.value = []; load() }
  else { requestId++; detailOpen.value = false; loading.value = false }
})
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="600" scrollable :persistent="clearing" aria-labelledby="pending-notes-title" @update:model-value="emit('update:modelValue', $event)">
    <v-card rounded="xl">
      <v-card-title id="pending-notes-title">Notas pendientes vencidas</v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-4">Limpiar los avisos marca las notas vencidas como completas de forma definitiva.</p>
        <v-alert v-if="error" type="error" role="alert" class="mb-4">{{ error }} <v-btn variant="text" :disabled="loading || clearing" @click="load">Reintentar</v-btn></v-alert>
        <v-progress-linear v-if="loading" indeterminate aria-label="Cargando notas pendientes" />
        <p v-else-if="!notes.length && !error" role="status">No hay notas pendientes vencidas.</p>
        <v-list v-else aria-label="Notas pendientes vencidas">
          <v-list-item v-for="note in notes" :key="note.id" class="pending-note mb-2" rounded="lg" :disabled="clearing || loading" :aria-label="`Ver detalle de la nota ${note.id}`" @click="openDetail(note)">
            <v-list-item-title class="note-title">#{{ note.id }} · {{ formatDate(note.date) }}</v-list-item-title>
            <p class="text-body-2">{{ note.assigned_name }}</p>
            <p class="note-preview text-body-2 my-2">{{ note.entries[0]?.text }}</p>
            <v-chip size="small" :color="note.priority === 'critical' ? 'red' : note.priority === 'atencion' ? 'amber-darken-3' : 'grey'">{{ priorities[note.priority] }}</v-chip>
            <span class="text-caption ml-2">Ver detalle</span>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-card-actions class="flex-wrap">
        <v-btn color="error" :loading="clearing" :disabled="loading || clearing || !notes.length" @click="clearAll">Limpiar todos</v-btn>
        <v-spacer /><v-btn :disabled="clearing" @click="emit('update:modelValue', false)">Cerrar</v-btn>
      </v-card-actions>
    </v-card>
    <DayNotesDialog v-model="detailOpen" :date="detailDate" :note-id="detailId" @changed="changed" @unauthorized="emit('unauthorized')" />
  </v-dialog>
</template>

<style scoped>
.pending-note { border: 1px solid #dfe7e2; }
.note-title { white-space: normal; }
.note-preview { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; white-space: pre-wrap; }
</style>
