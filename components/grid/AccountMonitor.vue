<template>
  <div class="flex justify-center items-center h-full">
    <UCheckbox
      :model-value="isMonitored"
      @update:model-value="toggle"
    />
  </div>
</template>

<script setup lang="ts">
import type { ICellRendererParams } from 'ag-grid-community';
import { isMonitored as checkMonitored, setMonitored } from '~/store/v2/autoSync';

const props = defineProps<{
  params: ICellRendererParams;
}>();

const fakeid = computed(() => props.params.data.fakeid);
const isMonitored = ref(checkMonitored(fakeid.value));

function toggle(value: boolean) {
  setMonitored(fakeid.value, value);
  isMonitored.value = value;
}
</script>
