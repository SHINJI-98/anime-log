<template>
  <dialog ref="dialog" class="desktop-settings" @cancel.prevent="$emit('close')">
    <header><h2>桌面设置</h2><button aria-label="关闭设置" @click="$emit('close')">×</button></header>
    <label for="close-action">点击窗口关闭按钮时</label>
    <select id="close-action" v-model="closeAction" :disabled="busy">
      <option value="tray">最小化至系统托盘（默认）</option>
      <option value="ball">关闭后保留悬浮球</option>
      <option value="quit">退出应用</option>
    </select>
    <label class="startup-option"><input v-model="lockPosition" type="checkbox" :disabled="busy" />锁定悬浮球位置</label>
    <button :disabled="busy" @click="resetPosition">重置悬浮球位置</button>
    <label>悬浮球大小<select v-model.number="ballSize" :disabled="busy"><option :value="48">小</option><option :value="64">中</option><option :value="80">大</option></select></label>
    <label>悬浮球不透明度 {{ Math.round(ballOpacity * 100) }}%<input v-model.number="ballOpacity" type="range" min="0.3" max="1" step="0.05" :disabled="busy" /></label>
    <label>周历背景不透明度 {{ Math.round(panelOpacity * 100) }}%<input v-model.number="panelOpacity" type="range" min="0.5" max="1" step="0.05" :disabled="busy || !panelTransparencySupported" /></label>
    <p v-if="!panelTransparencySupported">周历透明背景需要 Windows 11 22H2 或更新版本；当前使用实色背景。</p>
    <label class="startup-option"><input v-model="autoLaunch" type="checkbox" :disabled="busy || !autoLaunchSupported" />开机自启动</label>
    <label>开机启动时<select v-model="startupMode" :disabled="busy"><option value="ball">安静显示悬浮球</option><option value="tray">仅系统托盘</option></select></label>
    <p v-if="autoLaunchSupported">开启后，登录 Windows 时自动启动。免安装版移动位置后，请重新关闭并开启此选项。</p>
    <p v-else>开机自启动可在 Windows 打包版中设置。</p>
    <p>收进托盘后，点击托盘图标可恢复主界面；右键菜单可显示悬浮球或退出应用。</p>
    <p>悬浮球：拖动调整位置，悬停展开周历，移开鼠标后自动收起。</p>
    <p>所在屏幕有全屏窗口时暂时隐藏悬浮球，退出全屏后恢复。</p>
    <p v-if="fullscreenError" class="settings-error">全屏检测暂不可用。<details><summary>技术详情</summary>{{ fullscreenError }}</details></p>
    <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
    <footer><button :disabled="busy" @click="save">保存设置</button></footer>
  </dialog>
</template>

<script setup>
import { onMounted, ref } from 'vue'
const emit = defineEmits(['close'])
const dialog = ref(null)
const closeAction = ref('tray')
const lockPosition = ref(false)
const ballSize = ref(64)
const ballOpacity = ref(.72)
const panelOpacity = ref(.95)
const panelTransparencySupported = ref(true)
async function resetPosition() {
  try { await window.animeLogDesktop.resetPosition() } catch (e) { error.value = e.message }
}
const autoLaunch = ref(false)
const startupMode = ref('ball')
const autoLaunchSupported = ref(false)
const busy = ref(true)
const error = ref('')
const fullscreenError = ref('')
onMounted(async () => {
  dialog.value.showModal()
  try {
    const settings = await window.animeLogDesktop.getSettings()
    closeAction.value = settings.closeAction
    lockPosition.value = settings.lockPosition === true
    ballSize.value = settings.ballSize
    ballOpacity.value = settings.ballOpacity
    panelOpacity.value = settings.panelOpacity
    panelTransparencySupported.value = settings.panelTransparencySupported
    autoLaunch.value = settings.autoLaunch
    startupMode.value = settings.startupMode
    fullscreenError.value = settings.fullscreenError
    autoLaunchSupported.value = settings.autoLaunchSupported
  }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
})
async function save() {
  busy.value = true
  error.value = ''
  try {
    await window.animeLogDesktop.saveSettings({ closeAction: closeAction.value, lockPosition: lockPosition.value, autoLaunch: autoLaunch.value, ballSize: ballSize.value, ballOpacity: ballOpacity.value, panelOpacity: panelOpacity.value, startupMode: startupMode.value })
    emit('close')
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
</script>

<style scoped>
.desktop-settings { width: min(440px, calc(100vw - 40px)); box-sizing: border-box; padding: 24px; border: 1px solid #42434e; border-radius: 14px; background: #191b21; color: #e4e6ee; font: 14px/1.6 'Segoe UI', 'Microsoft YaHei', sans-serif; }
.desktop-settings::backdrop { background: #000a; }
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
h2 { font-size: 20px; margin: 0; }
label { display: block; margin-bottom: 8px; }
.startup-option { display: flex; align-items: center; gap: 10px; margin-top: 22px; }
.startup-option input { width: 16px; height: 16px; margin: 0; accent-color: #9f86dc; }
select { box-sizing: border-box; width: 100%; padding: 10px; background: #111319; color: #e4e6ee; border: 1px solid #484b58; border-radius: 7px; }
p { font-size: 12px; color: #a4adbd; margin: 12px 0; }
button { font: inherit; color: #e4d8ff; background: #352b49; border: 1px solid #655180; border-radius: 7px; padding: 6px 14px; cursor: pointer; }
header button { background: transparent; color: #b8becc; border: 0; font-size: 22px; padding: 0 6px; }
footer { margin-top: 24px; text-align: right; }
.settings-error { color: #ff9d92; }
button:disabled { opacity: .5; }
</style>
