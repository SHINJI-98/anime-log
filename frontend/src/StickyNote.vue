<template>
  <main class="sticky-note" :class="{ 'today-view': view === 'today', 'panel-hidden': !panelVisible }">
    <header class="sticky-topbar">
      <div class="sticky-heading"><h1>我的追番</h1><p>/ {{ dateLabel }}</p></div>
      <nav class="sticky-tools" aria-label="便签操作">
        <span class="watch-count">{{ records.length }} 部在看</span>
        <button :aria-pressed="pinned" @click="togglePin">{{ pinned ? '取消置顶' : '置顶' }}</button>
        <button :aria-pressed="view === 'today'" @click="view = 'today'">今天</button>
        <button :aria-pressed="view === 'week'" @click="view = 'week'">本周</button>
        <button :disabled="busy" @click="load">刷新</button>
        <button @click="$emit('settings')">设置</button>
        <button :disabled="busy" @click="$emit('expand')">完整界面 ↗</button>
      </nav>
    </header>
    <div v-if="error" class="sticky-message" role="alert">操作失败，请稍后重试。<details><summary>技术详情</summary>{{ error }}</details></div>
    <p v-if="undo" class="sticky-message" role="status">已记录 {{ undo.record.anime.title }} 的观看进度 <button :disabled="busy" @click="undoIncrement">撤销</button></p>
    <p v-if="busy && !records.length" class="sticky-message">加载中…</p>
    <p v-else-if="!records.length" class="sticky-message">还没有在看的番剧，打开完整界面添加吧。</p>
    <div class="week-scroll" tabindex="0" aria-label="一周放送表，可横向滚动">
      <div class="sticky-week">
        <section v-for="day in visibleDays" :key="day.index" class="weekday-column" :class="{ 'is-today': today === day.index }" :style="{ '--day-color': day.color }" :aria-label="day.label">
          <header class="weekday-header">
            <span v-if="today === day.index" class="today-ribbon">今天</span>
            <h2>{{ day.label }}</h2><span class="weekday-english">{{ day.english }}</span>
          </header>
          <ul class="day-cards">
            <StickyAnimeCard v-for="record in day.items" :key="record.id" :record="record" :busy="busy" @increment="increment(record)" />
          </ul>
          <p v-if="!day.items.length" class="day-empty">{{ view === 'today' ? '今天没有安排播出的追番' : '暂无追番' }} <button v-if="view === 'today'" @click="view = 'week'">查看本周</button></p>
        </section>
      </div>
    </div>
    <section v-if="unscheduled.length && view === 'week'" class="unscheduled" aria-label="其他与时间未定">
      <h2>其他 / 时间未定 <span>{{ unscheduled.length }}</span></h2>
      <ul class="unscheduled-cards"><StickyAnimeCard v-for="record in unscheduled" :key="record.id" :record="record" :busy="busy" @increment="increment(record)" /></ul>
    </section>
    <footer class="sticky-footer">我的追番 <span>按星期安排播出 · 点击 +1 记录观看进度</span></footer>
  </main>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import StickyAnimeCard from './StickyAnimeCard.vue'
import { getWatchRecords, updateWatchRecord } from './api'
defineEmits(['expand', 'settings'])
const records = ref([])
const busy = ref(false)
const error = ref('')
const view = ref(localStorage.getItem('anime-log-calendar-view') === 'today' ? 'today' : 'week')
watch(view, value => localStorage.setItem('anime-log-calendar-view', value))
const undo = ref(null)
let undoTimer
const visibleDays = computed(() => view.value === 'today' ? week.value.filter(day => day.index === today.value) : week.value)
const pinned = ref(false)
const now = ref(new Date())
const days = ['一', '二', '三', '四', '五', '六', '日']
const englishDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const colors = ['#f97515', '#eea00b', '#93bd13', '#4aaf2a', '#078dbd', '#1764ab', '#e94138']
const today = computed(() => (now.value.getDay() + 6) % 7)
const dateLabel = computed(() => `${now.value.getFullYear()}年${now.value.getMonth() + 1}月${now.value.getDate()}日 星期${days[today.value]}`)
function dayIndex(value) {
  const match = (value || '').match(/(?:周|星期|礼拜)([一二三四五六日天])/)
  return match ? days.indexOf(match[1] === '天' ? '日' : match[1]) : -1
}
const week = computed(() => days.map((day, index) => ({
  label: `星期${day}`, english: englishDays[index], color: colors[index], index,
  items: records.value.filter(record => dayIndex(record.anime.airDay) === index)
    .sort((a, b) => (a.anime.airTime || '99').localeCompare(b.anime.airTime || '99') || a.anime.title.localeCompare(b.anime.title, 'zh-CN'))
})))
const unscheduled = computed(() => records.value.filter(record => dayIndex(record.anime.airDay) === -1))
let clockTimer
let loaded = false
const panelVisible = ref(window.animeLogDesktop ? window.animeLogConfig.visible : !document.hidden)
let unsubscribeVisibility
function visibilityChanged() {
  clearInterval(clockTimer)
  if (!panelVisible.value) return
  now.value = new Date()
  clockTimer = setInterval(() => { now.value = new Date() }, 60000)
  if (!loaded && !busy.value) load()
}
onUnmounted(() => {
  clearInterval(clockTimer); clearTimeout(undoTimer)
  unsubscribeVisibility?.()
})
async function load() {
  if (busy.value) return
  clearTimeout(undoTimer)
  undo.value = null
  busy.value = true
  error.value = ''
  try { records.value = await getWatchRecords('watching'); loaded = true }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function increment(record) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  const previous = record.watchedEpisodes
  record.watchedEpisodes++
  try {
    await updateWatchRecord(record.id, { watchedEpisodes: record.watchedEpisodes })
    clearTimeout(undoTimer)
    undo.value = { record, previous }
    undoTimer = setTimeout(() => { undo.value = null }, 6000)
  } catch (e) { record.watchedEpisodes = previous; error.value = e.message }
  finally { busy.value = false }
}
async function undoIncrement() {
  if (!undo.value || busy.value) return
  const { record, previous } = undo.value
  clearTimeout(undoTimer)
  busy.value = true
  try {
    await updateWatchRecord(record.id, { watchedEpisodes: previous })
    record.watchedEpisodes = previous
    undo.value = null
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function togglePin() {
  try { pinned.value = await window.animeLogDesktop.setPinned(!pinned.value) }
  catch (e) { error.value = e.message }
}
onMounted(async () => {
  unsubscribeVisibility = window.animeLogDesktop.onVisibilityChanged(value => {
    panelVisible.value = value
    visibilityChanged()
  })
  panelVisible.value = await window.animeLogDesktop.getVisibility()
  try { pinned.value = await window.animeLogDesktop.getPinned() } catch (e) { error.value = e.message }
  visibilityChanged()
})
</script>

<style scoped>
.sticky-note { box-sizing: border-box; min-height: 100vh; padding: 12px; background: rgb(29 30 32 / var(--panel-opacity, .95)); color: #f4f4f4; font: 13px/1.4 'Segoe UI', 'Microsoft YaHei', sans-serif; }
.sticky-topbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
.sticky-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; -webkit-app-region: drag; flex: 1; }
.sticky-heading h1 { margin: 0; font-size: 25px; letter-spacing: -1px; white-space: nowrap; }
.sticky-heading p { margin: 0; font-size: 12px; color: #c0c2c6; white-space: nowrap; }
.sticky-tools { display: flex; align-items: center; gap: 6px; -webkit-app-region: no-drag; }
.watch-count { font-size: 11px; color: #92969f; margin-right: 4px; }
.sticky-tools button { min-height: 28px; padding: 4px 8px; border: 1px solid #42454a; border-radius: 4px; background: #292b2f; color: #dddfe4; cursor: pointer; font: inherit; font-size: 11px; }
.sticky-tools button:hover { background: #3b3e43; }
.sticky-tools button[aria-pressed=true] { border-color: #abbc75; color: #d9e7b5; }
.sticky-tools button:disabled { opacity: .45; cursor: default; }
.sticky-note :focus-visible { outline: 2px solid #eee; outline-offset: 2px; }
.sticky-message { padding: 12px; background: #2c2e32; color: #d6d8df; }
.sticky-message[role=alert] { color: #ffb2a6; }
.week-scroll { overflow-x: auto; scrollbar-color: #545860 #252629; }
.sticky-week { display: grid; grid-template-columns: repeat(7, minmax(96px, 1fr)); gap: 5px; min-width: 702px; align-items: stretch; }
.today-view .sticky-week { display: block; min-width: 0; }
.today-view .day-cards { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
.today-view .weekday-header { height: 60px; }
.panel-hidden { content-visibility: hidden; }
.weekday-column { min-width: 0; background: #232427; }
.weekday-header { position: relative; overflow: hidden; height: 76px; background: var(--day-color); display: flex; flex-direction: column; align-items: flex-end; justify-content: flex-end; padding: 10px; box-sizing: border-box; }
.weekday-header h2 { margin: 0; font-size: clamp(18px, 2.3vw, 28px); line-height: 1.1; font-weight: 600; color: white; }
.weekday-english { font-size: 18px; line-height: 1.1; color: #fffd; }
.today-ribbon { position: absolute; top: 11px; left: -28px; width: 104px; padding: 3px 0; text-align: center; transform: rotate(-45deg); background: #8656b7; color: white; font-size: 12px; box-shadow: 0 2px 4px #0002; }
.day-cards { list-style: none; padding: 0; margin: 5px 0 0; display: grid; gap: 6px; }
.is-today { box-shadow: inset 0 0 0 1px #ffffff25; }
.day-empty { margin: 28px 0; color: #727780; text-align: center; font-size: 11px; }
.unscheduled { margin-top: 18px; }
.unscheduled h2 { margin: 0 0 8px; font-size: 13px; color: #babec7; font-weight: 500; }
.unscheduled h2 span { margin-left: 6px; color: #787e89; }
.unscheduled-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(125px, 1fr)); gap: 6px; padding: 0; margin: 0; list-style: none; }
.sticky-footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 18px; color: #737780; font-size: 10px; letter-spacing: 1px; }
.sticky-footer span { letter-spacing: 0; }
</style>
