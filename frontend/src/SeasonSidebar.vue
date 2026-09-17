<template>
  <aside class="season-sidebar" aria-label="季度导航">
    <div class="sidebar-brand"><span class="brand-mark">番</span><div><strong>我的追番</strong><small>把喜欢的故事留下</small></div></div>
    <div class="sidebar-heading"><span>季度档案</span><span>SEASONS</span></div>
    <label class="year-picker">年份
      <select v-model="year" aria-label="季度年份">
        <option v-for="value in years" :key="value" :value="value">{{ value }} 年</option>
      </select>
    </label>
    <nav class="quarter-list" aria-label="季度列表">
      <button v-for="quarter in quarters" :key="quarter.month" :class="{ active: selected === `${year}${quarter.month}` }"
        :aria-current="selected === `${year}${quarter.month}` ? 'page' : undefined"
        :data-testid="`season-${year}${quarter.month}`" @click="$emit('select', `${year}${quarter.month}`)">
        <span class="quarter-symbol">{{ quarter.symbol }}</span><span>{{ year }} 年 {{ Number(quarter.month) }} 月<small>{{ quarter.label }}新番</small></span><span class="quarter-arrow">↗</span>
      </button>
    </nav>
    <button class="current-season-link" @click="$emit('current')">回到当前季度 →</button>
    <div class="sidebar-theme">
      <label for="theme-choice">界面配色</label>
      <select id="theme-choice" :value="theme" @change="$emit('theme', $event.target.value)">
        <option value="graphite">曜石黑</option><option value="ocean">深海蓝</option>
        <option value="forest">松林绿</option><option value="paper">暖纸白</option>
      </select>
      <p>每个季度，都有新的期待。</p>
    </div>
  </aside>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
const props = defineProps({ selected: String, theme: String })
defineEmits(['select', 'current', 'theme'])
const year = ref(new Date().getFullYear())
const years = computed(() => Array.from({ length: new Date().getFullYear() + 2 - 2000 }, (_, i) => new Date().getFullYear() + 1 - i))
watch(() => props.selected, value => { if (value) year.value = Number(value.slice(0, 4)) })
const quarters = [
  { month: '10', label: '秋季', symbol: '◒' }, { month: '07', label: '夏季', symbol: '☀' },
  { month: '04', label: '春季', symbol: '✿' }, { month: '01', label: '冬季', symbol: '❄' }
]
</script>
