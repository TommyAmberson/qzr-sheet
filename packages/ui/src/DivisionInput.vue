<script setup lang="ts">
/**
 * A box for a division's name, typed bare: `2`, not `Div 2`. A prefix typed anyway is dropped
 * once the box is left; a stored name shows as it is, so one saved with its prefix by mistake
 * shows until it is retyped.
 *
 * It shows the prefix inside it, so a list of these boxes reads `Div [2]`, `Div [2C]`. A box whose
 * label already says "Division" is `bare`: a plain input with no prefix, styled as the page's other
 * inputs. With a prefix, `class` and `style` style the whole box, so a page's own field class gives
 * it the page's look, and every other attribute, such as `placeholder`, `aria-label` or
 * `required`, goes to the input.
 */
import { computed, useAttrs } from 'vue'
import { DIVISION_PREFIX, bareDivision } from '@qzr/shared'

defineOptions({ inheritAttrs: false })
defineProps<{ bare?: boolean }>()
const model = defineModel<string>()
const emit = defineEmits<{ change: [name: string] }>()

const attrs = useAttrs()
const boxAttrs = computed(
  () => ({ class: attrs.class, style: attrs.style }) as Record<string, unknown>,
)
const inputAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs
  return rest
})

function settle(event: Event) {
  const input = event.target as HTMLInputElement
  const bare = bareDivision(input.value)
  // The model may already hold the bare name, which leaves the box showing what was typed
  input.value = bare
  model.value = bare
  emit('change', bare)
}
</script>

<template>
  <input v-if="bare" v-bind="attrs" v-model="model" @change="settle" />
  <span v-else class="division-input" v-bind="boxAttrs">
    <span class="division-input-prefix" aria-hidden="true">{{ DIVISION_PREFIX }}</span>
    <input v-bind="inputAttrs" v-model="model" class="division-input-field" @change="settle" />
  </span>
</template>

<style scoped>
.division-input {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  min-width: 0;
}

.division-input:focus-within {
  border-color: var(--color-accent);
}

.division-input-prefix {
  color: var(--color-text-muted, inherit);
  white-space: nowrap;
}

/* A page's own input rules, such as the builder's, would draw the input as a second box */
.division-input input.division-input-field,
.division-input input.division-input-field:focus {
  flex: 1;
  min-width: 2ch;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: inherit;
}
</style>
