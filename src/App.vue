<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import Bitwarden from './views/Bitwarden/index.vue'

const route = ref('')
const enterAction = ref({})
const showDemo = ref(false)

onMounted(() => {
  window.utools.onPluginEnter((action) => {
    route.value = action.code
    enterAction.value = action
    
    // 当进入hello功能时，显示PrimeVue示例
    if (action.code === 'hello') {
      showDemo.value = true
    }
  })
  window.utools.onPluginOut((isKill) => {
    route.value = ''
    showDemo.value = false
  })
})
</script>

<template>
  <template v-if="route === 'bitwarden'">
    <Bitwarden :enterAction="enterAction"></Bitwarden>
  </template>
</template>

<style>
.demo-container {
  padding: 2rem;
  max-width: 800px;
  margin: 0 auto;
}
</style>
