<script setup>
import { ref, watch } from 'vue'
import { userDisplayName } from '../helpers/user-display.js'
const props = defineProps({ modelValue: Boolean, role: { type: Object, default: null } })
const emit = defineEmits(['update:modelValue', 'saved', 'unauthorized'])
const users = ref([]), selected = ref(null), loading = ref(false), saving = ref(false), error = ref('')
let requestId = 0
async function request(url, options) {
  const response = await fetch(url, options)
  if (response.status === 401) emit('unauthorized')
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'No se pudo cambiar la asignación')
  return data
}
async function load() {
  const id = ++requestId
  selected.value = props.role?.assigned_user ?? null; users.value = []; error.value = ''; loading.value = true
  try {
    const data = await request('/api/users')
    if (id === requestId) users.value = data.users.filter(user => user.activo === 1 && ['usuario', 'admin'].includes(user.rol_usuario))
  } catch (err) { if (id === requestId) error.value = err.message }
  finally { if (id === requestId) loading.value = false }
}
async function save() {
  if (saving.value || loading.value || !selected.value || !props.role || selected.value === props.role.assigned_user) return
  saving.value = true; error.value = ''
  try {
    const week = await request(`/api/roles/${props.role.id}/assignment`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      assigned_user: selected.value, expected_assigned_user: props.role.assigned_user, expected_replace_user: props.role.replace_user,
    }) })
    emit('saved', week); emit('update:modelValue', false)
  } catch (err) { error.value = err.message }
  finally { saving.value = false }
}
watch(() => props.modelValue, open => { if (open) load(); else { requestId++; loading.value = false } })
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="480" :persistent="saving" aria-labelledby="assignment-title" @update:model-value="emit('update:modelValue', $event)">
    <v-card rounded="xl">
      <v-card-title id="assignment-title">Cambiar usuario asignado</v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-4">Día: {{ role?.date }} · Actual: {{ role?.assigned_name }}</p>
        <p v-if="role?.rol_switched" class="text-body-2 mb-4">Al cambiar el usuario se cancelará el intercambio vinculado a este día y se restaurará su parte recíproca.</p>
        <v-alert v-if="error" type="error" role="alert" class="mb-4">{{ error }}</v-alert>
        <v-form id="assignment-form" @submit.prevent="save">
          <v-select v-model="selected" :items="users" :item-title="userDisplayName" item-value="id" label="Usuario asignado" :loading="loading" :disabled="loading || saving" no-data-text="No hay usuarios activos disponibles" />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-btn :disabled="saving" @click="emit('update:modelValue', false)">Cancelar</v-btn><v-spacer />
        <v-btn type="submit" form="assignment-form" color="primary" :loading="saving" :disabled="saving || loading || !selected || selected === role?.assigned_user">Guardar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
