<template>
  <StickyNote v-if="compact" @expand="setCompact(false)" @settings="showSettings = true" />
  <div v-show="!compact">
    <button v-if="desktop" class="sticky-entry" @click="setCompact(true)">桌面便签</button>
    <button v-if="desktop" class="desktop-settings-entry" @click="showSettings = true">设置</button>
    <FullApp v-if="fullLoaded" :active="!compact" />
  </div>
  <DesktopSettings v-if="showSettings" @close="showSettings = false" />
</template>

<script setup>
import { defineAsyncComponent, nextTick, onUnmounted, ref, watch, watchEffect } from 'vue'
import StickyNote from './StickyNote.vue'
import DesktopSettings from './DesktopSettings.vue'
const FullApp = defineAsyncComponent(() => import('./App.vue'))
const desktop = window.animeLogDesktop
const showSettings = ref(false)
const compact = ref(!!desktop && window.animeLogConfig.compact === true)
const fullLoaded = ref(!compact.value)
const unsubscribe = desktop?.onModeChanged(value => {
  compact.value = value
  try { localStorage.setItem('anime-log-compact', String(value)) } catch {}
})
const unsubscribeSettings = desktop?.onSettingsRequested(() => { showSettings.value = true })
let fullScroll = 0
watch(compact, async (value) => {
  if (!value) fullLoaded.value = true
  if (value) fullScroll = window.scrollY
  await nextTick()
  window.scrollTo(0, value ? 0 : fullScroll)
}, { flush: 'pre' })
watch(showSettings, value => desktop?.setInteraction(value))
onUnmounted(() => { unsubscribe?.(); unsubscribeSettings?.() })
watchEffect(() => {
  document.body.classList.toggle('compact-desktop', compact.value)
  document.documentElement.classList.toggle('compact-desktop', compact.value)
})
async function setCompact(value) {
  await desktop.setCompact(value)
  compact.value = value
  try { localStorage.setItem('anime-log-compact', String(value)) } catch {}
}
</script>

<style>
.sticky-entry, .desktop-settings-entry { position: fixed; right: 18px; bottom: 18px; z-index: 20; padding: 10px 18px; border: 1px solid #66568e; border-radius: 24px; background: #302740; color: #e4d8ff; cursor: pointer; box-shadow: 0 3px 12px #0005; }
.desktop-settings-entry { right: 142px; background: #202228; border-color: #424652; color: #c4cad6; }
html.compact-desktop, body.compact-desktop { margin: 0; min-width: 0; background: transparent; }
</style>
