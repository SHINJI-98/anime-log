<template>
  <main class="app-shell">
    <SeasonSidebar :selected="view === 'discover' ? season : ''" :theme="theme" @select="jumpToSeason" @current="openCurrentSeason" @theme="setTheme" />
    <header class="topbar">
      <div>
        <p class="eyebrow">Anime Log</p>
        <h1>我的追番</h1>
      </div>
      <nav class="tabs" aria-label="主导航">
        <button data-testid="watchlist-tab" :class="{ active: view === 'watchlist' || view === 'notes' }" @click="view = 'watchlist'">追番</button>
        <button data-testid="discover-tab" :class="{ active: view === 'discover' }" @click="view = 'discover'">新番</button>
      </nav>
    </header>

    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-if="loading" class="notice">加载中...</p>

    <section v-if="view === 'watchlist'" class="panel" data-testid="watchlist-view">
      <div class="panel-header">
        <div>
          <h2>追番进度</h2>
          <p>{{ watchRecords.length }} 部记录</p>
        </div>
        <div class="filters" aria-label="追番状态筛选">
          <button v-if="desktopAvailable" data-testid="refresh-broadcast" :disabled="broadcastRefreshing" @click="refreshBroadcasts">
            {{ broadcastRefreshing ? '同步中…' : '同步放送' }}
          </button>
          <button
            v-for="item in statusTabs"
            :key="item.value"
            :data-testid="`status-${item.value}`"
            :class="{ active: selectedStatus === item.value }"
            @click="changeStatus(item.value)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <div v-if="watchRecords.length === 0 && !loading" class="empty-state">
        <h3>还没有追番记录</h3>
        <button @click="view = 'discover'">去新番页添加</button>
      </div>

      <div v-if="watchRecordGroups.length > 0" class="weekday-jump" aria-label="追番星期导航">
        <a
          v-for="group in watchRecordGroups"
          :key="group.day"
          :href="`#watch-day-${group.key}`"
          @click.prevent="scrollToSection(`watch-day-${group.key}`)"
        >
          {{ group.day }}
        </a>
      </div>

      <div v-if="watchRecordGroups.length > 0" class="schedule-board">
        <section
          v-for="group in watchRecordGroups"
          :id="`watch-day-${group.key}`"
          :key="group.day"
          class="day-section"
        >
          <div class="day-heading">
            <h3>{{ group.day }}</h3>
            <span>{{ group.items.length }} 部</span>
          </div>
          <div class="schedule-grid">
            <article
              v-for="record in group.items"
              :id="`watch-record-${record.anime.id}`"
              :key="record.id"
              class="schedule-item watch-schedule-item"
              data-testid="watch-record-card"
            >
              <div class="poster-wrap">
                <img
                  :src="posterSrc(record.anime.imageUrl)"
                  :alt="record.anime.title"
                  class="clickable-poster"
                  referrerpolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
                  @click="openPoster(record.anime)"
                  @error="useFallbackPoster"
                />
                <span class="time-badge">{{ record.anime.airTime || '时间未定' }}</span>
                <span class="status-badge">{{ statusLabel(record.status) }}</span>
              </div>
              <div class="schedule-info watch-schedule-info">
                <h4>{{ record.anime.title }}</h4>
                <p>{{ scheduleText(record.anime) }}</p>
                <div class="progress-row compact-progress">
                  <label>
                    已看
                    <input
                      type="number"
                      min="0"
                      :value="record.watchedEpisodes"
                      data-testid="progress-input"
                      @change="saveProgress(record, $event.target.value)"
                    />
                  </label>
                  <strong>/ {{ record.anime.totalEpisodes || '?' }}</strong>
                </div>
                <div v-if="record.broadcast" class="broadcast-status" data-testid="broadcast-status">
                  <template v-if="record.broadcast.requiresRelink">
                    <strong>放送数据源已切换为 AniList</strong>
                    <span>原 Bangumi 关联需要重新选择条目</span>
                  </template>
                  <template v-else>
                  <strong v-if="record.broadcast.estimatedAiredEpisode !== null">预计播至第 {{ formatEpisode(record.broadcast.estimatedAiredEpisode) }} 集</strong>
                  <strong v-else>放送进度未知</strong>
                  <span v-if="record.broadcast.todayEpisodes.length">今日预计第 {{ episodeList(record.broadcast.todayEpisodes) }} 集</span>
                  <span v-else-if="record.broadcast.next">预计第 {{ episodeList(record.broadcast.next.episodes) }} 集 · {{ formatAirDate(record.broadcast.next.date) }}</span>
                  <span v-else>下一集排期未知</span>
                  <small :class="{ 'sync-error': record.broadcast.error }">
                    AniList<span v-if="record.broadcast.lastSuccessAt"> · {{ formatSyncTime(record.broadcast.lastSuccessAt) }} 同步</span><span v-if="record.broadcast.error"> · 同步失败，可能过期</span>
                  </small>
                  <em v-if="record.broadcast.hasUnwatchedUpdate">有待看更新</em>
                  </template>
                </div>
                <button v-if="desktopAvailable" class="ghost compact broadcast-binding-button" data-testid="open-broadcast-binding" @click="openBroadcastBinding(record)">
                  {{ record.broadcast && !record.broadcast.requiresRelink ? '更换 AniList 关联' : '关联 AniList' }}
                </button>
                <div class="card-actions watch-card-actions">
                  <button
                    class="icon-button note-button"
                    type="button"
                    aria-label="打开笔记"
                    title="笔记"
                    data-testid="open-notes"
                    @click="openNotes(record)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 3.5h9.4L19 7.1v13.4H6z" />
                      <path d="M15 3.5v4h4" />
                      <path d="M9 11h6" />
                      <path d="M9 14h5" />
                      <path d="M9 17h3" />
                      <path d="M16.8 15.2l1.9 1.9-3.8 3.8-2.2.3.3-2.2z" />
                    </svg>
                  </button>
                  <select data-testid="record-status-select" :value="record.status" @change="saveStatus(record, $event.target.value)">
                    <option value="watching">在看</option>
                    <option value="completed">看完</option>
                    <option value="dropped">弃坑</option>
                  </select>
                  <button class="ghost danger compact-action" @click="removeRecord(record.id)">取消</button>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>
    </section>

    <section v-else-if="view === 'discover'" class="panel schedule-panel" data-testid="discover-view">
      <div class="panel-header">
        <div>
          <h2>新番资讯</h2>
          <p>{{ season.slice(0, 4) }} 年 {{ Number(season.slice(4)) }} 月新番</p>
        </div>
        <div class="season-controls">
          <button @click="shiftSeason(-3)">上一季</button>
          <button @click="loadCurrentSeason">当前季</button>
          <button @click="shiftSeason(3)">下一季</button>
          <button class="primary" data-testid="refresh-season" @click="refreshCurrentSeason">刷新</button>
        </div>
      </div>

      <div class="search-row">
        <input
          ref="animeSearchInput"
          v-model.trim="animeSearchQuery"
          data-testid="anime-search"
          type="search"
          placeholder="搜索新番标题、星期或时间"
        />
        <button v-if="animeSearchQuery" class="ghost compact-search-clear" type="button" @click="clearAnimeSearch">清除</button>
      </div>

      <div v-if="animeGroups.length > 0" class="weekday-jump" aria-label="星期导航">
        <a
          v-for="group in animeGroups"
          :key="group.day"
          :href="`#day-${group.key}`"
          @click.prevent="scrollToSection(`day-${group.key}`)"
        >
          {{ group.day }}
        </a>
      </div>

      <div v-if="animeGroups.length === 0 && !loading" class="empty-state">
        <h3>没有找到匹配的新番</h3>
        <button v-if="animeSearchQuery" @click="clearAnimeSearch">清除搜索</button>
      </div>

      <div v-else class="schedule-board">
        <section
          v-for="group in animeGroups"
          :id="`day-${group.key}`"
          :key="group.day"
          class="day-section"
        >
          <div class="day-heading">
            <h3>{{ group.day }}</h3>
            <span>{{ group.items.length }} 部</span>
          </div>
          <div class="schedule-grid">
            <article v-for="anime in group.items" :key="anime.id" class="schedule-item" data-testid="schedule-item">
              <div class="poster-wrap">
                <img
                  :src="posterSrc(anime.imageUrl)"
                  :alt="anime.title"
                  class="clickable-poster"
                  referrerpolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
                  @click="openPoster(anime)"
                  @error="useFallbackPoster"
                />
                <span class="time-badge">{{ anime.airTime || '时间未定' }}</span>
                <span v-if="anime.totalEpisodes" class="episode-badge">全{{ anime.totalEpisodes }}话</span>
              </div>
              <div class="schedule-info">
                <h4>{{ anime.title }}</h4>
                <button
                  class="primary compact"
                  data-testid="follow-anime"
                  :disabled="isAnimeFollowed(anime.id)"
                  @click="followAnime(anime.id)"
                >
                  {{ isAnimeFollowed(anime.id) ? '已追番' : '追番' }}
                </button>
              </div>
            </article>
          </div>
        </section>
      </div>
    </section>

    <section v-else-if="view === 'notes' && selectedNoteRecord" class="panel notes-panel" data-testid="notes-view">
      <div class="notes-header">
        <button class="ghost" type="button" @click="backToWatchlist">返回追番列表</button>
        <div class="notes-title">
          <img
            :src="posterSrc(selectedNoteRecord.anime.imageUrl)"
            :alt="selectedNoteRecord.anime.title"
            referrerpolicy="no-referrer"
            decoding="async"
            @error="useFallbackPoster"
          />
          <div>
            <p class="eyebrow">Anime Notes</p>
            <h2>{{ selectedNoteRecord.anime.title }}</h2>
            <p>{{ scheduleText(selectedNoteRecord.anime) }}</p>
          </div>
        </div>
      </div>

      <div class="notes-layout">
        <section class="note-editor">
          <div class="section-heading">
            <h3>总结</h3>
            <button class="primary compact" data-testid="save-summary" type="button" @click="saveSummary">保存总结</button>
          </div>
          <div class="rich-text-editor">
            <div class="rich-text-toolbar" aria-label="富文本工具栏">
              <button type="button" title="粗体" @mousedown.prevent="formatRichText('bold')"><strong>B</strong></button>
              <button type="button" title="斜体" @mousedown.prevent="formatRichText('italic')"><em>I</em></button>
              <button type="button" title="下划线" @mousedown.prevent="formatRichText('underline')"><span class="underline-icon">U</span></button>
              <button type="button" title="标题" @mousedown.prevent="formatRichText('formatBlock', 'H3')">H</button>
              <button type="button" title="正文" @mousedown.prevent="formatRichText('formatBlock', 'P')">P</button>
              <button type="button" title="无序列表" @mousedown.prevent="formatRichText('insertUnorderedList')">•</button>
              <button type="button" title="有序列表" @mousedown.prevent="formatRichText('insertOrderedList')">1.</button>
              <button type="button" title="引用" @mousedown.prevent="formatRichText('formatBlock', 'BLOCKQUOTE')">“”</button>
              <button type="button" title="插入图片" @mousedown.prevent="openImagePicker">图</button>
              <button type="button" title="清除格式" @mousedown.prevent="formatRichText('removeFormat')">Tx</button>
            </div>
            <div
              class="rich-text-input"
              contenteditable="true"
              dir="ltr"
              lang="zh-CN"
              role="textbox"
              aria-multiline="true"
              data-placeholder="写一点整体评价、观看感受、推荐理由..."
              data-testid="summary-editor"
              v-rich-text-html="summaryDraft"
              @blur="updateSummaryDraft"
              @compositionend="finishRichTextComposition(updateSummaryDraft, $event)"
              @compositionstart="startRichTextComposition"
              @focus="rememberRichTextSelection"
              @input="updateSummaryDraft"
              @keyup="rememberRichTextSelection"
              @mouseup="rememberRichTextSelection"
              @paste="handleRichTextPaste"
            ></div>
          </div>
        </section>

        <section class="note-editor">
          <div class="section-heading">
            <h3>分集评论</h3>
          </div>
          <div class="episode-create">
            <label>
              第
              <input v-model.number="newEpisodeNumber" data-testid="episode-number-input" type="number" min="1" />
              集
            </label>
            <div class="rich-text-editor compact-rich-text">
              <div class="rich-text-toolbar" aria-label="富文本工具栏">
                <button type="button" title="粗体" @mousedown.prevent="formatRichText('bold')"><strong>B</strong></button>
                <button type="button" title="斜体" @mousedown.prevent="formatRichText('italic')"><em>I</em></button>
                <button type="button" title="无序列表" @mousedown.prevent="formatRichText('insertUnorderedList')">•</button>
                <button type="button" title="插入图片" @mousedown.prevent="openImagePicker">图</button>
                <button type="button" title="清除格式" @mousedown.prevent="formatRichText('removeFormat')">Tx</button>
              </div>
              <div
                class="rich-text-input"
                contenteditable="true"
                dir="ltr"
                lang="zh-CN"
                role="textbox"
                aria-multiline="true"
                data-placeholder="添加这一集的评论..."
                data-testid="new-episode-editor"
                v-rich-text-html="newEpisodeContent"
                @blur="updateNewEpisodeContent"
                @compositionend="finishRichTextComposition(updateNewEpisodeContent, $event)"
                @compositionstart="startRichTextComposition"
                @focus="rememberRichTextSelection"
                @input="updateNewEpisodeContent"
                @keyup="rememberRichTextSelection"
                @mouseup="rememberRichTextSelection"
                @paste="handleRichTextPaste"
              ></div>
            </div>
            <button class="primary compact" data-testid="add-episode-note" type="button" @click="addEpisodeNote">添加/更新</button>
          </div>

          <div v-if="notes.episodeNotes.length === 0" class="empty-state compact-empty">
            还没有分集评论
          </div>
          <article v-for="note in notes.episodeNotes" :key="note.id" class="episode-note" data-testid="episode-note">
            <div class="section-heading">
              <h4>第 {{ note.episodeNumber }} 集</h4>
              <div class="episode-actions">
                <button class="compact" type="button" @click="saveEpisode(note)">保存</button>
                <button class="ghost danger compact" type="button" @click="removeEpisode(note)">删除</button>
              </div>
            </div>
            <div class="rich-text-editor">
              <div class="rich-text-toolbar" aria-label="富文本工具栏">
                <button type="button" title="粗体" @mousedown.prevent="formatRichText('bold')"><strong>B</strong></button>
                <button type="button" title="斜体" @mousedown.prevent="formatRichText('italic')"><em>I</em></button>
                <button type="button" title="下划线" @mousedown.prevent="formatRichText('underline')"><span class="underline-icon">U</span></button>
                <button type="button" title="标题" @mousedown.prevent="formatRichText('formatBlock', 'H3')">H</button>
                <button type="button" title="正文" @mousedown.prevent="formatRichText('formatBlock', 'P')">P</button>
                <button type="button" title="无序列表" @mousedown.prevent="formatRichText('insertUnorderedList')">•</button>
                <button type="button" title="有序列表" @mousedown.prevent="formatRichText('insertOrderedList')">1.</button>
                <button type="button" title="引用" @mousedown.prevent="formatRichText('formatBlock', 'BLOCKQUOTE')">“”</button>
                <button type="button" title="插入图片" @mousedown.prevent="openImagePicker">图</button>
                <button type="button" title="清除格式" @mousedown.prevent="formatRichText('removeFormat')">Tx</button>
              </div>
              <div
                class="rich-text-input"
                contenteditable="true"
                dir="ltr"
                lang="zh-CN"
                role="textbox"
                aria-multiline="true"
                data-placeholder="记录这一集的想法..."
                v-rich-text-html="episodeDrafts[note.episodeNumber]"
                @blur="updateEpisodeDraft(note.episodeNumber, $event)"
                @compositionend="finishRichTextComposition((event) => updateEpisodeDraft(note.episodeNumber, event), $event)"
                @compositionstart="startRichTextComposition"
                @focus="rememberRichTextSelection"
                @input="updateEpisodeDraft(note.episodeNumber, $event)"
                @keyup="rememberRichTextSelection"
                @mouseup="rememberRichTextSelection"
                @paste="handleRichTextPaste"
              ></div>
            </div>
          </article>
        </section>
      </div>
    </section>
    <button
      v-show="showBackTop"
      class="back-to-top"
      type="button"
      aria-label="回到顶部"
      title="回到顶部"
      @click="scrollToTop"
    >
      ↑
    </button>

    <div v-if="previewAnime" class="poster-modal" role="dialog" aria-modal="true" @click="closePoster">
      <div class="poster-modal-content" @click.stop>
        <button class="poster-close" type="button" aria-label="关闭大图" title="关闭" @click="closePoster">
          ×
        </button>
        <img
          :src="posterSrc(previewAnime.imageUrl)"
          :alt="previewAnime.title"
          referrerpolicy="no-referrer"
          decoding="async"
          @error="useFallbackPoster"
        />
        <p>{{ previewAnime.title }}</p>
      </div>
    </div>
    <div v-if="bindingRecord" class="poster-modal" role="dialog" aria-modal="true" aria-label="关联 AniList" @click="closeBroadcastBinding">
      <div class="binding-dialog" @click.stop>
        <header><div><p class="eyebrow">放送排期</p><h2>关联 AniList</h2></div><button class="ghost" aria-label="关闭关联窗口" @click="closeBroadcastBinding">×</button></header>
        <p>为“{{ bindingRecord.anime.title }}”选择对应动画条目。关联后会自动同步预计放送进度。</p>
        <p>在看番剧会按唯一精确中文名称自动关联。这里可搜索简体、繁体及别名，或输入 AniList 动画链接更换关联。</p>
        <form class="binding-search" @submit.prevent="runAniListSearch">
          <input v-model.trim="bindingQuery" data-testid="anilist-search-input" maxlength="120" placeholder="番剧标题" />
          <button class="primary" :disabled="bindingBusy">搜索</button>
        </form>
        <p v-if="bindingError" class="notice error">{{ bindingError }}</p>
        <div v-if="bindingCandidates.length" class="binding-candidates">
          <article v-for="candidate in bindingCandidates" :key="candidate.id">
            <img :src="candidate.imageUrl || fallbackPoster" :alt="candidate.displayName || candidate.name" @error="useFallbackPoster" />
            <div><strong>{{ candidate.displayName || candidate.name }}</strong><small v-if="candidate.displayName && candidate.name">{{ candidate.name }}</small><span>{{ candidate.airDate || '首播日期未知' }} · ID {{ candidate.id }}</span><small v-if="candidate.metadataUnavailable">AniList 暂不可用，显示本地名称；关联时会重新核验。</small></div>
            <button class="primary compact" data-testid="bind-anilist-candidate" :disabled="bindingBusy" @click="bindAniList(candidate.id)">确认关联</button>
          </article>
        </div>
        <div v-else-if="bindingSearched && !bindingBusy" class="empty-state compact-empty">未找到此译名，可尝试其他译名、英文或日文名，也可输入 AniList 链接或 ID。</div>
        <form class="binding-manual" @submit.prevent="bindManualAniList">
          <input v-model.trim="manualAniList" data-testid="anilist-manual-input" placeholder="https://anilist.co/anime/123 或 123" />
          <button :disabled="bindingBusy">使用链接或 ID</button>
        </form>
        <label v-if="bindingRecord.broadcast && !bindingRecord.broadcast.requiresRelink" class="binding-notify"><input type="checkbox" :disabled="bindingBusy" :checked="bindingRecord.broadcast.notifyEnabled" @change="toggleRecordNotification($event.target.checked)" />此番剧允许系统通知</label>
        <button v-if="bindingRecord.broadcast" class="ghost danger" data-testid="unbind-anilist" :disabled="bindingBusy" @click="unbindAniList">解除关联并停止自动关联</button>
      </div>
    </div>
  </main>
</template>

<script setup>
import './styles.css'
import SeasonSidebar from './SeasonSidebar.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
const props = defineProps({ active: { type: Boolean, default: true } })
watch(() => props.active, value => { if (value) loadWatchRecords() })
import {
  addWatchRecord,
  apiUrl,
  deleteEpisodeNote,
  deleteWatchRecord,
  deleteBroadcastBinding,
  getAnime,
  getAnimeNotes,
  getCurrentSeason,
  getWatchRecords,
  getAniListSubject,
  refreshBroadcast,
  refreshAnime,
  saveBroadcastBinding,
  searchAniList,
  saveEpisodeNote,
  saveSummaryNote,
  updateWatchRecord
} from './api'

const view = ref('watchlist')
const desktopAvailable = !!window.animeLogDesktop
const loading = ref(false)
const error = ref('')
const selectedStatus = ref('watching')
const watchRecords = ref([])
const followedAnimeSourceIds = ref(new Set())
const animeList = ref([])
const animeSearchInput = ref(null)
const animeSearchQuery = ref('')
const season = ref('')
const theme = ref('graphite')
const broadcastRefreshing = ref(false)
const bindingRecord = ref(null)
const bindingQuery = ref('')
const bindingCandidates = ref([])
const bindingBusy = ref(false)
const bindingError = ref('')
const bindingSearched = ref(false)
const manualAniList = ref('')
const unsubscribeBroadcast = window.animeLogDesktop?.onBroadcastUpdated(() => loadWatchRecords())
const unsubscribeBroadcastFocus = window.animeLogDesktop?.onBroadcastFocus(async animeSourceId => {
  view.value = 'watchlist'
  selectedStatus.value = 'watching'
  await loadWatchRecords()
  if (animeSourceId) requestAnimationFrame(() => document.getElementById(`watch-record-${animeSourceId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  else scrollToTop()
})
try { const saved = localStorage.getItem('anime-log-theme'); if (['graphite', 'ocean', 'forest', 'paper'].includes(saved)) theme.value = saved } catch {}
watch(theme, value => {
  document.documentElement.dataset.theme = value
  try { localStorage.setItem('anime-log-theme', value) } catch {}
}, { immediate: true })
function setTheme(value) { if (['graphite', 'ocean', 'forest', 'paper'].includes(value)) theme.value = value }
function jumpToSeason(value) { view.value = 'discover'; animeSearchQuery.value = ''; return selectSeason(value) }
function openCurrentSeason() { view.value = 'discover'; animeSearchQuery.value = ''; return loadCurrentSeason() }
let seasonRequest = 0
async function selectSeason(value, refresh = false) {
  const request = ++seasonRequest
  season.value = value
  animeList.value = []
  loading.value = true
  error.value = ''
  try {
    const result = await (refresh ? refreshAnime(value) : getAnime(value))
    if (request === seasonRequest) animeList.value = result
  } catch (err) { if (request === seasonRequest) error.value = err.message }
  finally { if (request === seasonRequest) loading.value = false }
}
const showBackTop = ref(false)
const previewAnime = ref(null)
const selectedNoteRecord = ref(null)
const notes = ref({ summary: null, episodeNotes: [] })
const summaryDraft = ref('')
const episodeDrafts = ref({})
const newEpisodeNumber = ref(1)
const newEpisodeContent = ref('')
let savedRichTextRange = null
const fallbackPoster =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="450"><rect width="100%25" height="100%25" fill="%23e8edf3"/><text x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%235f6b7a" font-family="Arial" font-size="24">No Image</text></svg>'

const vRichTextHtml = {
  mounted(element, binding) {
    setRichTextHtml(element, binding.value)
  },
  updated(element, binding) {
    if (binding.value === binding.oldValue || document.activeElement === element) {
      return
    }
    setRichTextHtml(element, binding.value)
  }
}

const dayOrder = [
  '周一 (月)',
  '周二 (火)',
  '周三 (水)',
  '周四 (木)',
  '周五 (金)',
  '周六 (土)',
  '周日 (日)',
  '网络播放 & 其他',
  '其他'
]
const statusTabs = [
  { value: 'watching', label: '在看' },
  { value: 'completed', label: '看完' },
  { value: 'dropped', label: '弃坑' },
  { value: 'all', label: '全部' }
]

const filteredAnimeList = computed(() => {
  const query = animeSearchQuery.value.trim().toLocaleLowerCase()
  if (!query) {
    return animeList.value
  }
  return animeList.value.filter((anime) => animeMatchesSearch(anime, query))
})

const animeGroups = computed(() => groupItemsByDay(filteredAnimeList.value, (anime) => anime))

const watchRecordGroups = computed(() => groupItemsByDay(watchRecords.value, (record) => record.anime))

function animeMatchesSearch(anime, query) {
  return [
    anime.title,
    anime.airDay,
    anime.airTime,
    anime.totalEpisodes ? String(anime.totalEpisodes) : ''
  ]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase().includes(query))
}

function groupItemsByDay(items, selectAnime) {
  const grouped = new Map()
  for (const item of items) {
    const anime = selectAnime(item)
    const day = anime.airDay || '其他'
    if (!grouped.has(day)) {
      grouped.set(day, [])
    }
    grouped.get(day).push(item)
  }

  const known = dayOrder
    .filter((day) => grouped.has(day))
    .map((day) => ({
      day,
      key: dayKey(day),
      items: grouped.get(day)
    }))
  const extra = Array.from(grouped.entries())
    .filter(([day]) => !dayOrder.includes(day))
    .map(([day, items]) => ({
      day,
      key: dayKey(day),
      items
    }))
  return [...known, ...extra]
}

onMounted(async () => {
  window.addEventListener('scroll', updateBackTopVisibility, { passive: true })
  window.addEventListener('keydown', handleKeydown)
  updateBackTopVisibility()
  await loadCurrentSeason()
  await loadFollowedAnimeSourceIds()
  await loadWatchRecords()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', updateBackTopVisibility)
  window.removeEventListener('keydown', handleKeydown)
  unsubscribeBroadcast?.()
  unsubscribeBroadcastFocus?.()
})

async function withLoading(action) {
  loading.value = true
  error.value = ''
  try {
    await action()
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function loadCurrentSeason() {
  const request = ++seasonRequest
  loading.value = true
  error.value = ''
  try {
    const current = await getCurrentSeason()
    if (request === seasonRequest) await selectSeason(current.season)
  } catch (err) { if (request === seasonRequest) error.value = err.message }
  finally { if (request === seasonRequest) loading.value = false }
}

async function loadWatchRecords() {
  await withLoading(async () => {
    watchRecords.value = await getWatchRecords(selectedStatus.value)
  })
}

async function refreshBroadcasts() {
  broadcastRefreshing.value = true
  error.value = ''
  try {
    await refreshBroadcast()
    await loadWatchRecords()
  } catch (err) { error.value = err.message }
  finally { broadcastRefreshing.value = false }
}

async function openBroadcastBinding(record) {
  bindingRecord.value = record
  bindingQuery.value = record.broadcast?.subject.name || record.anime.title
  bindingCandidates.value = []
  bindingError.value = ''
  bindingSearched.value = false
  manualAniList.value = record.broadcast && !record.broadcast.requiresRelink ? String(record.broadcast.subject.id) : ''
  await runAniListSearch()
}

function closeBroadcastBinding() {
  if (!bindingBusy.value) bindingRecord.value = null
}

async function runAniListSearch() {
  if (!bindingQuery.value) return
  bindingBusy.value = true
  bindingError.value = ''
  try { bindingCandidates.value = await searchAniList(bindingQuery.value); bindingSearched.value = true }
  catch (err) { bindingError.value = err.message }
  finally { bindingBusy.value = false }
}

async function bindAniList(subjectId, notifyEnabled = bindingRecord.value?.broadcast?.notifyEnabled ?? true) {
  if (!bindingRecord.value) return
  bindingBusy.value = true
  bindingError.value = ''
  try {
    await saveBroadcastBinding(bindingRecord.value.anime.id, subjectId, notifyEnabled)
    await loadWatchRecords()
    bindingRecord.value = null
  } catch (err) { bindingError.value = err.message }
  finally { bindingBusy.value = false }
}

async function bindManualAniList() {
  let id = /^\d+$/.test(manualAniList.value) ? Number(manualAniList.value) : null
  if (id === null) {
    try {
      const url = new URL(manualAniList.value)
      const match = url.pathname.match(/^\/anime\/(\d+)(?:\/[^/]*)?\/?$/)
      if (url.protocol === 'https:' && url.hostname === 'anilist.co' && !url.port && !url.username && !url.password && match) id = Number(match[1])
    } catch {}
  }
  if (!Number.isSafeInteger(id) || id < 1) { bindingError.value = '请输入有效的 AniList 动画链接或 ID'; return }
  bindingBusy.value = true
  bindingError.value = ''
  try {
    bindingCandidates.value = [await getAniListSubject(id)]
    bindingSearched.value = true
  } catch (err) { bindingError.value = err.message }
  finally { bindingBusy.value = false }
}

async function unbindAniList() {
  if (!bindingRecord.value) return
  bindingBusy.value = true
  try {
    await deleteBroadcastBinding(bindingRecord.value.anime.id)
    await loadWatchRecords()
    bindingRecord.value = null
  } catch (err) { bindingError.value = err.message }
  finally { bindingBusy.value = false }
}

async function toggleRecordNotification(enabled) {
  if (!bindingRecord.value?.broadcast) return
  bindingBusy.value = true
  try {
    await saveBroadcastBinding(bindingRecord.value.anime.id, bindingRecord.value.broadcast.subject.id, enabled)
    await loadWatchRecords()
    bindingRecord.value = watchRecords.value.find(record => record.id === bindingRecord.value.id) || null
  } catch (err) { bindingError.value = err.message }
  finally { bindingBusy.value = false }
}

function formatEpisode(value) { return Number.isInteger(value) ? String(value) : String(Number(value)) }
function episodeList(episodes) { return episodes.map(item => formatEpisode(item.episodeNumber)).join('、') }
function formatAirDate(value) {
  const [, , month, day] = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/) || []
  return month ? `${Number(month)} 月 ${Number(day)} 日` : value
}
function formatSyncTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function loadFollowedAnimeSourceIds() {
  const records = await getWatchRecords('all')
  followedAnimeSourceIds.value = new Set(records.map((record) => String(record.anime.id)))
}

async function changeStatus(status) {
  selectedStatus.value = status
  await loadWatchRecords()
}

async function shiftSeason(months) {
  const year = Number(season.value.slice(0, 4))
  const month = Number(season.value.slice(4, 6))
  const date = new Date(year, month - 1 + months, 1)
  const nextMonth = Math.floor(date.getMonth() / 3) * 3 + 1
  await selectSeason(`${date.getFullYear()}${String(nextMonth).padStart(2, '0')}`)
}

async function refreshCurrentSeason() {
  await selectSeason(season.value, true)
}

async function followAnime(animeSourceId) {
  if (isAnimeFollowed(animeSourceId)) {
    return
  }
  await withLoading(async () => {
    await addWatchRecord(animeSourceId)
    await loadFollowedAnimeSourceIds()
    view.value = 'watchlist'
    selectedStatus.value = 'watching'
    watchRecords.value = await getWatchRecords(selectedStatus.value)
  })
}

async function saveStatus(record, status) {
  await withLoading(async () => {
    await updateWatchRecord(record.id, { status })
    await loadWatchRecords()
  })
}

async function saveProgress(record, value) {
  const watchedEpisodes = Math.max(0, Number(value) || 0)
  await withLoading(async () => {
    await updateWatchRecord(record.id, { watchedEpisodes })
    await loadWatchRecords()
  })
}

async function removeRecord(id) {
  await withLoading(async () => {
    await deleteWatchRecord(id)
    await loadFollowedAnimeSourceIds()
    await loadWatchRecords()
  })
}

function isAnimeFollowed(animeSourceId) {
  return followedAnimeSourceIds.value.has(String(animeSourceId))
}

async function openNotes(record) {
  selectedNoteRecord.value = record
  await withLoading(async () => {
    await loadNotes(record.anime.id)
    view.value = 'notes'
    scrollToTop()
  })
}

async function loadNotes(animeSourceId) {
  const data = await getAnimeNotes(animeSourceId)
  notes.value = {
    summary: data.summary,
    episodeNotes: data.episodeNotes || []
  }
  summaryDraft.value = data.summary ? noteContentToRichText(data.summary.content) : ''
  episodeDrafts.value = {}
  for (const note of notes.value.episodeNotes) {
    episodeDrafts.value[note.episodeNumber] = noteContentToRichText(note.content)
  }
  const nextEpisode = selectedNoteRecord.value ? selectedNoteRecord.value.watchedEpisodes + 1 : 1
  newEpisodeNumber.value = Math.max(1, nextEpisode)
}

async function saveSummary() {
  if (!selectedNoteRecord.value) {
    return
  }
  await withLoading(async () => {
    await saveSummaryNote(selectedNoteRecord.value.anime.id, sanitizeRichText(summaryDraft.value))
    await loadNotes(selectedNoteRecord.value.anime.id)
  })
}

async function addEpisodeNote() {
  if (!selectedNoteRecord.value) {
    return
  }
  const episodeNumber = Math.max(1, Math.floor(Number(newEpisodeNumber.value) || 1))
  await withLoading(async () => {
    await saveEpisodeNote(selectedNoteRecord.value.anime.id, episodeNumber, sanitizeRichText(newEpisodeContent.value))
    newEpisodeContent.value = ''
    await loadNotes(selectedNoteRecord.value.anime.id)
  })
}

async function saveEpisode(note) {
  if (!selectedNoteRecord.value) {
    return
  }
  await withLoading(async () => {
    await saveEpisodeNote(
      selectedNoteRecord.value.anime.id,
      note.episodeNumber,
      sanitizeRichText(episodeDrafts.value[note.episodeNumber] || '')
    )
    await loadNotes(selectedNoteRecord.value.anime.id)
  })
}

async function removeEpisode(note) {
  if (!selectedNoteRecord.value) {
    return
  }
  await withLoading(async () => {
    await deleteEpisodeNote(selectedNoteRecord.value.anime.id, note.episodeNumber)
    await loadNotes(selectedNoteRecord.value.anime.id)
  })
}

function backToWatchlist() {
  view.value = 'watchlist'
  selectedNoteRecord.value = null
}

function scheduleText(anime) {
  return [anime.airDay, anime.airTime].filter(Boolean).join(' ') || '放送时间未知'
}

function posterSrc(imageUrl) {
  return imageUrl ? apiUrl(`/api/images/proxy?url=${encodeURIComponent(imageUrl)}`) : fallbackPoster
}

function useFallbackPoster(event) {
  if (event.target.src !== fallbackPoster) {
    event.target.src = fallbackPoster
  }
}

function updateBackTopVisibility() {
  showBackTop.value = window.scrollY > 360
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function scrollToSection(id) {
  const target = document.getElementById(id)
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.history.replaceState(null, '', `#${id}`)
  }
}

function clearAnimeSearch() {
  animeSearchQuery.value = ''
  focusAnimeSearch()
}

function focusAnimeSearch() {
  if (view.value !== 'discover') {
    return
  }
  requestAnimationFrame(() => {
    if (animeSearchInput.value) {
      animeSearchInput.value.focus()
      animeSearchInput.value.select()
    }
  })
}

function dayKey(day) {
  const keys = {
    '\u5468\u4e00 (\u6708)': 'monday',
    '\u5468\u4e8c (\u706b)': 'tuesday',
    '\u5468\u4e09 (\u6c34)': 'wednesday',
    '\u5468\u56db (\u6728)': 'thursday',
    '\u5468\u4e94 (\u91d1)': 'friday',
    '\u5468\u516d (\u571f)': 'saturday',
    '\u5468\u65e5 (\u65e5)': 'sunday',
    '\u7f51\u7edc\u653e\u9001 & \u5176\u4ed6': 'online',
    '\u5176\u4ed6': 'other'
  }
  return keys[day] || `extra-${Math.abs(hashString(day))}`
}

function hashString(value) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return hash
}

function openPoster(anime) {
  if (anime.imageUrl) {
    previewAnime.value = anime
  }
}

function closePoster() {
  previewAnime.value = null
}

function handleKeydown(event) {
  if (!props.active) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && view.value === 'discover') {
    event.preventDefault()
    focusAnimeSearch()
    return
  }
  if (event.key === 'Escape') {
    closePoster()
  }
}

function statusLabel(status) {
  return {
    watching: '在看',
    completed: '看完',
    dropped: '弃坑'
  }[status]
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

function updateSummaryDraft(event) {
  if (event.target.dataset.composing === 'true') {
    return
  }
  summaryDraft.value = normalizeEditorHtml(event.target.innerHTML)
}

function updateNewEpisodeContent(event) {
  if (event.target.dataset.composing === 'true') {
    return
  }
  newEpisodeContent.value = normalizeEditorHtml(event.target.innerHTML)
}

function updateEpisodeDraft(episodeNumber, event) {
  if (event.target.dataset.composing === 'true') {
    return
  }
  episodeDrafts.value[episodeNumber] = normalizeEditorHtml(event.target.innerHTML)
}

function rememberRichTextSelection(event) {
  const editor = event?.target?.closest?.('.rich-text-input') || document.activeElement
  if (!editor?.classList?.contains('rich-text-input')) {
    return
  }
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return
  }
  const range = selection.getRangeAt(0)
  if (editor.contains(range.commonAncestorContainer)) {
    savedRichTextRange = range.cloneRange()
  }
}

function startRichTextComposition(event) {
  event.target.dataset.composing = 'true'
}

function finishRichTextComposition(updateDraft, event) {
  event.target.dataset.composing = 'false'
  updateDraft(event)
}

function formatRichText(command, value = null) {
  rememberRichTextSelection()
  document.execCommand(command, false, value)
  const editor = document.activeElement
  if (editor?.classList.contains('rich-text-input')) {
    dispatchRichTextInput(editor)
    editor.focus()
  }
}

function handleRichTextPaste(event) {
  const imageFiles = [...event.clipboardData.items]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean)

  if (imageFiles.length > 0) {
    event.preventDefault()
    rememberRichTextSelection(event)
    for (const file of imageFiles) {
      insertImageFile(file)
    }
    return
  }

  event.preventDefault()
  const clipboard = event.clipboardData
  const html = clipboard.getData('text/html')
  const text = clipboard.getData('text/plain')
  const content = html ? sanitizeRichText(html) : plainTextToRichText(text)
  document.execCommand('insertHTML', false, content)
  dispatchRichTextInput()
}

function openImagePicker() {
  rememberRichTextSelection()
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.addEventListener(
    'change',
    () => {
      const file = input.files?.[0]
      if (file) {
        insertImageFile(file)
      }
    },
    { once: true }
  )
  input.click()
}

function insertImageFile(file) {
  if (!file.type.startsWith('image/')) {
    return
  }
  const reader = new FileReader()
  reader.addEventListener('load', () => {
    insertRichTextImage(String(reader.result || ''), file.name)
  })
  reader.readAsDataURL(file)
}

function insertRichTextImage(src, alt = '') {
  const editor = restoreRichTextSelection()
  if (!editor) {
    return
  }
  const imageHtml = `<p><img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}"></p><p><br></p>`
  document.execCommand('insertHTML', false, imageHtml)
  dispatchRichTextInput(editor)
  rememberRichTextSelection({ target: editor })
}

function restoreRichTextSelection() {
  const selection = window.getSelection()
  const editor = getSavedRangeEditor() || document.activeElement
  if (!selection || !editor?.classList?.contains('rich-text-input')) {
    return null
  }
  editor.focus()
  if (savedRichTextRange) {
    selection.removeAllRanges()
    selection.addRange(savedRichTextRange)
  }
  return editor
}

function getSavedRangeEditor() {
  if (!savedRichTextRange) {
    return null
  }
  const container =
    savedRichTextRange.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? savedRichTextRange.commonAncestorContainer
      : savedRichTextRange.commonAncestorContainer.parentElement
  return container?.closest?.('.rich-text-input') || null
}

function dispatchRichTextInput(editor = document.activeElement) {
  if (editor?.classList?.contains('rich-text-input')) {
    editor.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

function noteContentToRichText(content) {
  const source = String(content || '').trim()
  if (!source) {
    return ''
  }
  return looksLikeHtml(source) ? sanitizeRichText(source) : markdownTextToRichText(source)
}

function markdownTextToRichText(content) {
  const lines = String(content || '').split(/\r?\n/)
  const html = lines
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) {
        return '<p><br></p>'
      }
      if (trimmed.startsWith('### ')) {
        return `<h5>${formatInlineMarkdown(trimmed.slice(4))}</h5>`
      }
      if (trimmed.startsWith('## ')) {
        return `<h4>${formatInlineMarkdown(trimmed.slice(3))}</h4>`
      }
      if (trimmed.startsWith('# ')) {
        return `<h3>${formatInlineMarkdown(trimmed.slice(2))}</h3>`
      }
      return `<p>${formatInlineMarkdown(trimmed)}</p>`
    })
    .join('')
  return sanitizeRichText(html)
}

function plainTextToRichText(content) {
  return String(content || '')
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>'))
    .join('')
}

function formatInlineMarkdown(content) {
  return escapeHtml(content)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
}

function looksLikeHtml(content) {
  return /<\/?[a-z][\s\S]*>/i.test(content)
}

function normalizeEditorHtml(html) {
  const value = String(html || '').trim()
  return value === '<br>' || value === '<div><br></div>' || value === '<p><br></p>' ? '' : value
}

function setRichTextHtml(element, html) {
  const value = String(html || '')
  if (element.innerHTML !== value) {
    element.innerHTML = value
  }
}

function sanitizeRichText(html) {
  if (!html) {
    return ''
  }
  const template = document.createElement('template')
  template.innerHTML = String(html)
  const allowedTags = new Set([
    'A',
    'B',
    'BLOCKQUOTE',
    'BR',
    'CODE',
    'DIV',
    'EM',
    'H3',
    'H4',
    'H5',
    'I',
    'IMG',
    'LI',
    'OL',
    'P',
    'S',
    'STRONG',
    'U',
    'UL'
  ])

  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove()
      return
    }
    if (!allowedTags.has(node.tagName)) {
      const children = [...node.childNodes]
      node.replaceWith(...children)
      for (const child of children) {
        cleanNode(child)
      }
      return
    }

    for (const attribute of [...node.attributes]) {
      const isSafeLink =
        node.tagName === 'A' &&
        attribute.name === 'href' &&
        /^(https?:|mailto:|\/|#)/i.test(attribute.value)
      const isSafeImage =
        node.tagName === 'IMG' &&
        ((attribute.name === 'src' &&
          /^(data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,|https?:|\/)/i.test(attribute.value)) ||
          attribute.name === 'alt')
      if (!isSafeLink && !isSafeImage) {
        node.removeAttribute(attribute.name)
      }
    }

    if (node.tagName === 'IMG' && !node.hasAttribute('src')) {
      node.remove()
      return
    }

    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }

    for (const child of [...node.childNodes]) {
      cleanNode(child)
    }
  }

  for (const child of [...template.content.childNodes]) {
    cleanNode(child)
  }
  return template.innerHTML.trim()
}
</script>
