<template>
  <li class="sticky-anime-card">
    <div class="sticky-cover">
      <img v-if="record.anime.imageUrl && !failed" :src="apiUrl(`/api/images/proxy?url=${encodeURIComponent(record.anime.imageUrl)}`)" :alt="record.anime.title" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="failed = true" />
      <div v-else class="cover-fallback" aria-hidden="true"><span>{{ record.anime.title.slice(0, 2) }}</span><small>ANIME LOG</small></div>
      <span v-if="record.anime.airTime" class="air-time">{{ record.anime.airTime }}</span>
      <h3 :title="record.anime.title">{{ record.anime.title }}</h3>
    </div>
    <div class="sticky-progress"><span>已看 {{ record.watchedEpisodes }} / {{ record.anime.totalEpisodes || '?' }}</span><button :disabled="busy || (record.anime.totalEpisodes > 0 && record.watchedEpisodes >= record.anime.totalEpisodes)" :aria-label="`${record.anime.title} 已看加一集`" @click="$emit('increment')">+1</button></div>
    <div class="sticky-broadcast" data-testid="sticky-broadcast" :title="broadcastHint">
      {{ airedEpisode === null ? '播出未知' : `预计播至第 ${airedEpisode} 集` }}
      <small v-if="airedEpisode !== null && (record.broadcast.stale || record.broadcast.error)">数据可能过期</small>
    </div>
  </li>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { apiUrl } from './api'
const props = defineProps({ record: { type: Object, required: true }, busy: Boolean })
defineEmits(['increment'])
const failed = ref(false)
const airedEpisode = computed(() => {
  const broadcast = props.record.broadcast
  return broadcast && !broadcast.requiresRelink && Number.isFinite(broadcast.estimatedAiredEpisode) ? broadcast.estimatedAiredEpisode : null
})
const broadcastHint = computed(() => {
  const broadcast = props.record.broadcast
  if (!broadcast || broadcast.requiresRelink) return '关联 AniList 后显示放送进度'
  return `按 AniList 排期推算，不含今日待播集数${broadcast.lastSuccessAt ? ` · 最近同步 ${new Date(broadcast.lastSuccessAt).toLocaleString('zh-CN')}` : ''}`
})
watch(() => props.record.anime.imageUrl, () => { failed.value = false })
</script>

<style scoped>
.sticky-anime-card { min-width: 0; list-style: none; background: #151618; }
.sticky-cover { position: relative; aspect-ratio: 1 / 1; overflow: hidden; background: #33373f; }
.sticky-cover img { width: 100%; height: 100%; display: block; object-fit: cover; object-position: center 25%; }
.sticky-cover h3 { position: absolute; inset: auto 0 0; margin: 0; padding: 7px 5px; background: #111b; color: #fff; font-size: 12px; line-height: 1.3; font-weight: 500; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.air-time { position: absolute; top: 5px; left: 5px; max-width: calc(100% - 18px); padding: 2px 4px; background: #0009; color: #fff; font-size: 10px; border-radius: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cover-fallback { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(145deg, #454c59, #242730); color: #bfc5d2; }
.cover-fallback span { font-size: 28px; font-weight: 300; letter-spacing: 4px; }
.cover-fallback small { font-size: 8px; letter-spacing: 2px; color: #89919f; }
.sticky-progress { display: flex; justify-content: space-between; align-items: center; gap: 3px; padding: 4px 5px; color: #b7bdc9; font-size: 10px; }
.sticky-progress button { min-height: 22px; padding: 1px 5px; border: 1px solid #444a55; border-radius: 3px; background: #282c33; color: #e2e6ee; font: inherit; cursor: pointer; }
.sticky-progress button:hover { background: #424957; }
.sticky-progress button:disabled { opacity: .4; cursor: default; }
.sticky-progress button:focus-visible { outline: 2px solid #eee; outline-offset: 2px; }
.sticky-broadcast { padding: 0 5px 6px; color: #c6d4e5; font-size: 10px; line-height: 1.5; overflow-wrap: anywhere; }
.sticky-broadcast small { display: block; color: #d4b97f; font-size: 9px; }
</style>
