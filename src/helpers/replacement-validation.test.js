import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, h, nextTick, ref } from 'vue'
import useVuelidate from '@vuelidate/core'
import { required } from '@vuelidate/validators'
import { useReplacementValidation } from './replacement-validation.js'

test('replacement validation allows submission independently of a closed password dialog', async () => {
  // A minimal Vue host exercises parent/child validation registration without a browser.
  const renderer = createRenderer({
    createElement: () => ({}), insert() {}, remove() {}, patchProp() {},
    createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {},
    parentNode: () => null, nextSibling: () => null,
  })
  const selectedUser = ref(null), selectedDay = ref(null)
  const days = ref([{ id: 10 }, { id: 11 }])
  let replacementValidation, passwordValidation
  const ClosedPasswordDialog = {
    setup() {
      passwordValidation = useVuelidate({ password: { required } }, { password: ref('') })
      return () => null
    },
  }
  const app = renderer.createApp({
    setup() {
      replacementValidation = useReplacementValidation(selectedUser, selectedDay, days)
      return () => h(ClosedPasswordDialog)
    },
  })
  app.mount({})
  try {
    await nextTick()
    assert.equal(passwordValidation.value.$invalid, true)
    assert.equal(await replacementValidation.value.$validate(), false)
    selectedUser.value = 2
    assert.equal(await replacementValidation.value.$validate(), false)
    selectedDay.value = 11
    assert.equal(await replacementValidation.value.$validate(), true)
    assert.equal(replacementValidation.value.$errors.length, 0)
    assert.equal(passwordValidation.value.$dirty, false)
    assert.equal(passwordValidation.value.$invalid, true)
    selectedDay.value = null
    assert.equal(await replacementValidation.value.$validate(), false)
    days.value = [{ id: 10 }]
    assert.equal(await replacementValidation.value.$validate(), true)
  } finally { app.unmount() }
})
