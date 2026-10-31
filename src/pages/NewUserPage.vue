<script setup>
import { reactive, ref } from 'vue'
import useVuelidate from '@vuelidate/core'
import { required, maxLength, helpers } from '@vuelidate/validators'
defineProps({ user: { type: Object, required: true } })
const emit = defineEmits(['back', 'saved', 'unauthorized'])
const form = reactive({ nombre: '', apellido: '', username: '', ultimo_rol: '', activo: true, rol_usuario: 'usuario' })
const textRules = { required: helpers.withMessage('Este campo es obligatorio', required), maxLength: helpers.withMessage('Máximo 100 caracteres', maxLength(100)) }
const validation = useVuelidate({ nombre: textRules, apellido: textRules, username: textRules }, form)
const roles = ['usuario', 'admin']
const saving = ref(false), error = ref('')
async function save() {
  if (!(await validation.value.$validate())) return
  saving.value = true; error.value = ''
  try {
    const response = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await response.json()
    if (response.status === 401) { emit('unauthorized'); return }
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar el usuario')
    Object.assign(form, { nombre: '', apellido: '', username: '', ultimo_rol: '', activo: true, rol_usuario: 'usuario' })
    validation.value.$reset(); emit('saved')
  } catch (err) { error.value = err.message }
  finally { saving.value = false }
}
</script>
<template>
  <v-container class="new-user-container">
    <v-btn variant="text" @click="emit('back')" class="mb-4">Volver</v-btn>
    <v-card rounded="xl" class="pa-6">
      <h1 class="text-h5 mb-5">Nuevo usuario</h1>
      <v-alert v-if="error" type="error" role="alert" class="mb-4">{{ error }}</v-alert>
      <v-form @submit.prevent="save" :disabled="saving">
        <v-text-field v-model="form.nombre" label="Nombre" maxlength="100" :error-messages="validation.nombre.$errors.map(e => e.$message)" @blur="validation.nombre.$touch()" />
        <v-text-field v-model="form.apellido" label="Apellido" maxlength="100" :error-messages="validation.apellido.$errors.map(e => e.$message)" @blur="validation.apellido.$touch()" />
        <v-text-field v-model="form.username" label="Usuario" autocomplete="off" maxlength="100" :error-messages="validation.username.$errors.map(e => e.$message)" @blur="validation.username.$touch()" />
        <v-alert type="info" variant="tonal" class="mb-4">La contraseña temporal será el nombre seguido del apellido, en minúsculas, sin separador y sin espacios al inicio o final de cada campo. El usuario deberá cambiarla al iniciar sesión.</v-alert>
        <v-text-field v-model="form.ultimo_rol" label="Último rol (opcional)" type="date" />
        <v-select v-model="form.rol_usuario" label="Rol de usuario" :items="roles" />
        <v-switch v-model="form.activo" label="Activo" color="primary" />
        <v-btn type="submit" color="primary" class="responsive-action" :loading="saving">Guardar usuario</v-btn>
      </v-form>
    </v-card>
  </v-container>
</template>

<style scoped>
.new-user-container { max-width: 680px; min-height: 100vh; min-height: 100dvh; padding: max(20px, env(safe-area-inset-top)) clamp(16px, 4vw, 32px) max(24px, env(safe-area-inset-bottom)); }
</style>
