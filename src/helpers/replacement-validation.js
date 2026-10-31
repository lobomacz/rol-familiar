import useVuelidate from '@vuelidate/core'
import { required, requiredIf, helpers } from '@vuelidate/validators'

export function useReplacementValidation(selectedReplacement, selectedReplacementDay, replacementDays) {
  return useVuelidate({
    selectedReplacement: { required: helpers.withMessage('Seleccione un sustituto', required) },
    selectedReplacementDay: { required: helpers.withMessage('Seleccione un día del sustituto', requiredIf(() => replacementDays.value.length > 1)) },
  }, { selectedReplacement, selectedReplacementDay }, {
    // This form must not collect validation from unrelated descendant dialogs.
    $scope: false,
  })
}
