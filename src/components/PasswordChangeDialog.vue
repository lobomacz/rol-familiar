<script setup>
import { ref, reactive, computed } from 'vue'
import useVuelidate from '@vuelidate/core'
import { required, helpers, sameAs } from '@vuelidate/validators'
import { passwordRequirements, isStrongPassword } from '../helpers/password-policy.js'
const props = defineProps({ forced: Boolean })
const emit = defineEmits(['saved', 'unauthorized', 'logout'])
const model = defineModel({ type: Boolean, default: false })
const passwordDialog = computed({ get: () => props.forced || model.value, set: value => { if (!props.forced) model.value = value } })
const changingPassword = ref(false), passwordError = ref('')
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const passwordValidation = useVuelidate(computed(() => ({
  currentPassword: { required: helpers.withMessage('Ingrese su contraseña actual', required) },
  newPassword: { strong: helpers.withMessage('Use exactamente 16 caracteres, con minúsculas, mayúsculas, números y símbolos.', isStrongPassword) },
  confirmPassword: { required: helpers.withMessage('Confirme la nueva contraseña', required), sameAs: helpers.withMessage('Las contraseñas no coinciden', sameAs(passwordForm.newPassword)) },
})), passwordForm)
const passwordStrength = computed(() => passwordRequirements.filter(rule => rule.test(passwordForm.newPassword)).length)
const strengthLabel = computed(() => !passwordForm.newPassword ? 'Sin contraseña' : passwordStrength.value === 5 ? 'Fuerte' : passwordStrength.value >= 3 ? 'Media' : 'Débil')
function resetPasswordForm() {
  Object.assign(passwordForm, { currentPassword: '', newPassword: '', confirmPassword: '' })
  passwordError.value = ''; passwordValidation.value.$reset()
}
async function changePassword() {
  if (changingPassword.value || !(await passwordValidation.value.$validate())) return
  changingPassword.value = true; passwordError.value = ''
  try {
    await request('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(passwordForm) })
    passwordDialog.value = false; emit('saved')
    resetPasswordForm()
  } catch (err) { passwordError.value = err.message }
  finally { changingPassword.value = false }
}
async function request(url, options) {
  const response = await fetch(url, options)
  if (response.status === 401) { emit('unauthorized'); throw new Error('La sesión ha vencido') }
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'No se pudo actualizar la contraseña')
  return data
}
</script>
<template>
    <v-dialog v-model="passwordDialog" max-width="480" scrollable :persistent="forced || changingPassword" aria-labelledby="password-title" @after-leave="resetPasswordForm">
      <v-card rounded="xl">
        <v-card-title id="password-title">Cambiar contraseña</v-card-title>
        <v-card-text>
          <p v-if="forced" class="text-body-2 mb-4">Tu contraseña es temporal. Crea una contraseña fuerte para continuar.</p>
          <v-form id="password-form" :disabled="changingPassword" @submit.prevent="changePassword">
            <v-alert v-if="passwordError" type="error" variant="tonal" role="alert" class="mb-4">{{ passwordError }}</v-alert>
            <v-text-field v-model="passwordForm.currentPassword" label="Contraseña actual" type="password" autocomplete="current-password" maxlength="1024" :error-messages="passwordValidation.currentPassword.$errors.map(e => e.$message)" @blur="passwordValidation.currentPassword.$touch()" />
            <v-text-field v-model="passwordForm.newPassword" label="Nueva contraseña" type="password" autocomplete="new-password" maxlength="16" counter="16" :error-messages="passwordValidation.newPassword.$errors.map(e => e.$message)" @blur="passwordValidation.newPassword.$touch()" aria-describedby="password-strength" />
            <v-text-field v-model="passwordForm.confirmPassword" label="Confirmar nueva contraseña" type="password" autocomplete="new-password" maxlength="16" :error-messages="passwordValidation.confirmPassword.$errors.map(e => e.$message)" @blur="passwordValidation.confirmPassword.$touch()" />
            <div id="password-strength" class="mt-2" aria-live="polite">
              <p class="text-body-2 mb-2">Fortaleza: {{ strengthLabel }}</p>
              <v-progress-linear :model-value="passwordStrength * 20" :color="passwordStrength === 5 ? 'success' : passwordStrength >= 3 ? 'warning' : 'error'" rounded height="8" aria-label="Fortaleza de la contraseña" />
              <ul class="password-requirements text-caption mt-3">
                <li v-for="rule in passwordRequirements" :key="rule.label" :class="{ 'text-success': rule.test(passwordForm.newPassword) }">{{ rule.test(passwordForm.newPassword) ? '✓' : '○' }} {{ rule.label }}</li>
              </ul>
            </div>
          </v-form>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn v-if="!forced" :disabled="changingPassword" @click="passwordDialog = false">Cancelar</v-btn>
          <v-btn v-else :disabled="changingPassword" @click="emit('logout')">Cerrar sesión</v-btn>
          <v-spacer />
          <v-btn type="submit" form="password-form" color="primary" :loading="changingPassword">Guardar contraseña</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
</template>
<style scoped>
.password-requirements { list-style: none; padding: 0; display: grid; gap: 4px; }
</style>
