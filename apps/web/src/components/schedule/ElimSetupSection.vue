<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import {
  estimateLaneQuizzes,
  laneLabel,
  TOGGLEABLE_LANES,
  type ExtraLane,
  type LaneId,
} from '../../brackets'

const props = defineProps<{
  divisions: string[]
  teamCounts: Record<string, number>
  extraLanes: Record<string, ExtraLane[]>
  editable: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-lane', payload: { division: string; lane: LaneId }): void
  (e: 'resize-lane', payload: { division: string; lane: LaneId; teamCount: number }): void
}>()

interface RenderLane {
  id: LaneId
  label: string
  teamCount: number
  estimate: number
  removable: boolean
}

interface DivisionRow {
  division: string
  teamCount: number
  lanes: RenderLane[]
  elimEstimate: number
  laneTotal: number
  oversubscribed: boolean
}

const rows = computed<DivisionRow[]>(() =>
  props.divisions.map((d) => {
    const teamCount = props.teamCounts[d] ?? 0
    const extras = props.extraLanes[d] ?? []
    const usedByExtras = extras.reduce((sum, l) => sum + l.teamCount, 0)
    const mainSize = Math.max(0, teamCount - usedByExtras)
    const lanes: RenderLane[] = [
      {
        id: 'main',
        label: laneLabel(d, 'main'),
        teamCount: mainSize,
        estimate: estimateLaneQuizzes(mainSize),
        removable: false,
      },
      ...extras.map((l) => ({
        id: l.id,
        label: laneLabel(d, l.id),
        teamCount: l.teamCount,
        estimate: estimateLaneQuizzes(l.teamCount),
        removable: true,
      })),
    ]
    return {
      division: d,
      teamCount,
      lanes,
      elimEstimate: lanes.reduce((sum, l) => sum + l.estimate, 0),
      laneTotal: lanes.reduce((sum, l) => sum + l.teamCount, 0),
      oversubscribed: usedByExtras > teamCount,
    }
  }),
)

const totalElim = computed(() => rows.value.reduce((sum, r) => sum + r.elimEstimate, 0))

function isEnabled(division: string, lane: LaneId): boolean {
  return (props.extraLanes[division] ?? []).some((l) => l.id === lane)
}

/**
 * Lane-split slider. Each division has one bar whose width is divided
 * proportionally between its lanes (main + optional C / CC). Handles sit
 * between segments; dragging a handle moves teams between the two
 * adjacent lanes while keeping the others fixed. Pointer events only —
 * the HTML5 drag API crashes on Linux/X11 per CLAUDE.md.
 */
interface DragState {
  division: string
  /** The extra lane on the LEFT side of the handle, or null when the
   *  handle sits between main and the first extra. We don't emit
   *  resize-lane for main because main is derived. */
  leftLaneId: LaneId | null
  /** The extra lane on the RIGHT side of the handle. Always non-null. */
  rightLaneId: LaneId
  totalTeams: number
  /** Lower bound on the cumulative team count up to and including
   *  leftLane — the sum of lanes strictly to the left of leftLane. */
  pinFloor: number
  /** Upper bound on the cumulative team count — total minus the sum of
   *  lanes strictly to the right of rightLane. */
  pinCeiling: number
}

const barRefs = ref<Record<string, HTMLElement | null>>({})
/** Per-division pixel offsets of segment right-edges, measured from the
 *  bar's left edge. Handles are pinned to these offsets so they always
 *  overlap the actual flex-resolved segment boundary, no matter how the
 *  CSS percentages would have resolved. */
const segmentBoundaries = ref<Record<string, number[]>>({})
const dragging = ref<DragState | null>(null)
let resizeObserver: ResizeObserver | null = null

function measureBars() {
  const boundaries: Record<string, number[]> = {}
  for (const [division, el] of Object.entries(barRefs.value)) {
    if (!el) continue
    const barRect = el.getBoundingClientRect()
    const segs = el.querySelectorAll<HTMLElement>('.lane-segment')
    const offsets: number[] = []
    for (let i = 0; i < segs.length - 1; i++) {
      const r = segs[i]!.getBoundingClientRect()
      offsets.push(r.right - barRect.left)
    }
    boundaries[division] = offsets
  }
  segmentBoundaries.value = boundaries
}

onMounted(() => {
  measureBars()
  resizeObserver = new ResizeObserver(measureBars)
  for (const el of Object.values(barRefs.value)) {
    if (el) resizeObserver.observe(el)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

/** When the rows change (lane sizes edited), the bar's clientWidth
 *  doesn't change but the segment boundaries do — flex redistributes
 *  the same width across new ratios. ResizeObserver won't fire for
 *  this, so re-measure on the next tick after every props update. */
watch(rows, () => {
  nextTick().then(measureBars)
})

interface HandleSpec {
  /** Lane immediately to the left of the handle. */
  leftLane: RenderLane
  /** Lane immediately to the right of the handle. */
  rightLane: RenderLane
  /** Cumulative team count up to and including leftLane. */
  cumulative: number
}

function handlesFor(row: DivisionRow): HandleSpec[] {
  const handles: HandleSpec[] = []
  let cumulative = 0
  for (let i = 0; i < row.lanes.length - 1; i++) {
    cumulative += row.lanes[i]!.teamCount
    handles.push({
      leftLane: row.lanes[i]!,
      rightLane: row.lanes[i + 1]!,
      cumulative,
    })
  }
  return handles
}

function setBarRef(division: string, el: Element | null) {
  const prev = barRefs.value[division]
  if (prev && resizeObserver) resizeObserver.unobserve(prev)
  barRefs.value[division] = el as HTMLElement | null
  if (el && resizeObserver) resizeObserver.observe(el as Element)
}

/** Pixel offset for handle `i`, read directly from the rendered DOM
 *  position of segment `i`'s right edge. Falls back to 0 before the
 *  first measurement (the handle won't be visible to the user yet). */
function handleLeftPx(row: DivisionRow, handleIndex: number): number {
  return segmentBoundaries.value[row.division]?.[handleIndex] ?? 0
}

function onHandleDown(row: DivisionRow, handle: HandleSpec, event: PointerEvent) {
  if (!props.editable || row.teamCount <= 0) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)

  // Pin the lanes that aren't adjacent to this handle. Floor = sum of
  // lanes strictly LEFT of leftLane; ceiling = total − (sum of lanes
  // strictly RIGHT of rightLane).
  let pinFloor = 0
  for (const l of row.lanes) {
    if (l.id === handle.leftLane.id) break
    pinFloor += l.teamCount
  }
  let afterRight = 0
  let seenRight = false
  for (const l of row.lanes) {
    if (seenRight) afterRight += l.teamCount
    if (l.id === handle.rightLane.id) seenRight = true
  }
  const pinCeiling = row.teamCount - afterRight

  dragging.value = {
    division: row.division,
    leftLaneId: handle.leftLane.id === 'main' ? null : handle.leftLane.id,
    rightLaneId: handle.rightLane.id,
    totalTeams: row.teamCount,
    pinFloor,
    pinCeiling,
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
  window.addEventListener('pointercancel', onPointerUp, { once: true })
}

function onPointerMove(event: PointerEvent) {
  const drag = dragging.value
  if (!drag) return
  const bar = barRefs.value[drag.division]
  if (!bar) return
  const rect = bar.getBoundingClientRect()
  if (rect.width === 0 || drag.totalTeams === 0) return
  const ratio = (event.clientX - rect.left) / rect.width
  const rawCumulative = Math.round(ratio * drag.totalTeams)
  const newCumulative = Math.min(drag.pinCeiling, Math.max(drag.pinFloor, rawCumulative))

  // newCumulative = teams in lanes up to and including leftLane.
  // newLeft = newCumulative - pinFloor.
  // newRight = pinCeiling - newCumulative.
  const newLeft = newCumulative - drag.pinFloor
  const newRight = drag.pinCeiling - newCumulative

  if (drag.leftLaneId === null) {
    // main is on the left; we don't emit for main (derived). Emit for
    // rightLane, whose new size is what makes main shrink/grow.
    emit('resize-lane', {
      division: drag.division,
      lane: drag.rightLaneId,
      teamCount: newRight,
    })
  } else {
    // Both lanes are extras. Emit both resizes so the slider moves
    // teams between them with no impact on other lanes.
    emit('resize-lane', {
      division: drag.division,
      lane: drag.leftLaneId,
      teamCount: newLeft,
    })
    emit('resize-lane', {
      division: drag.division,
      lane: drag.rightLaneId,
      teamCount: newRight,
    })
  }
}

function onPointerUp() {
  dragging.value = null
  window.removeEventListener('pointermove', onPointerMove)
  // Whichever of pointerup/pointercancel fired clears itself via
  // {once: true}; the other never fires for this drag, so remove it.
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}
</script>

<template>
  <section class="elim-setup">
    <header class="section-head">
      <h2 class="section-title">Elim setup</h2>
      <p class="section-meta">
        <span>~{{ totalElim }} elim quizzes</span>
        <span class="rule" aria-hidden="true">/</span>
        <span>{{ divisions.length }} divisions</span>
      </p>
      <span v-if="editable" class="draft-badge">Draft</span>
    </header>

    <ol class="divisions">
      <li v-for="row in rows" :key="row.division" class="division">
        <div class="division-head">
          <h3 class="division-name">Division {{ row.division }}</h3>
          <dl class="division-stats">
            <div class="stat">
              <dt>Teams</dt>
              <dd>{{ row.teamCount }}</dd>
            </div>
            <div class="stat">
              <dt>Elim&nbsp;est</dt>
              <dd>~{{ row.elimEstimate }}</dd>
            </div>
          </dl>
        </div>

        <div class="lanes">
          <div v-if="row.lanes.length === 1" class="single-lane">
            <span class="lane-name">{{ row.lanes[0]!.label }}</span>
            <span class="lane-stat">
              <span class="lane-size">{{ row.lanes[0]!.teamCount }}</span>
              <span class="lane-stat-label">teams</span>
              <span class="lane-rule" aria-hidden="true">·</span>
              <span class="lane-est">~{{ row.lanes[0]!.estimate }}</span>
              <span class="lane-stat-label">elim</span>
            </span>
          </div>

          <div
            v-else
            :ref="(el) => setBarRef(row.division, el as Element | null)"
            class="lane-bar"
            :class="{ 'is-disabled': !editable || row.teamCount === 0 }"
            :data-team-count="row.teamCount"
          >
            <div
              v-for="lane in row.lanes"
              :key="lane.id"
              class="lane-segment"
              :class="{ 'lane-segment--main': lane.id === 'main' }"
              :style="{
                /* Empty lanes (teamCount === 0) get a near-zero flex-grow
                   so they keep a sliver of width — enough for the handle
                   that sits at their boundary to remain reachable.
                   Pure-zero would collapse the lane and snap two handles
                   on top of each other. */
                flexGrow: lane.teamCount > 0 ? lane.teamCount : 0.0001,
                flexShrink: 1,
                flexBasis: '0%',
              }"
            >
              <span class="lane-name">{{ lane.label }}</span>
              <span class="lane-segment-count">{{ lane.teamCount }}</span>
              <span class="lane-segment-est">~{{ lane.estimate }} elim</span>
              <button
                v-if="lane.removable && editable"
                type="button"
                class="lane-remove"
                :title="`Remove ${lane.label}`"
                @click="emit('toggle-lane', { division: row.division, lane: lane.id })"
              >
                ×
              </button>
            </div>

            <button
              v-for="(handle, i) in editable && row.teamCount > 0 ? handlesFor(row) : []"
              :key="`handle-${i}`"
              type="button"
              class="lane-handle"
              :style="{ left: `${handleLeftPx(row, i)}px` }"
              :title="`Drag to split ${handle.leftLane.label} / ${handle.rightLane.label}`"
              :aria-label="`Split ${handle.leftLane.label} and ${handle.rightLane.label}`"
              @pointerdown="onHandleDown(row, handle, $event)"
            />
          </div>

          <div class="lane-actions">
            <button
              v-for="lane in TOGGLEABLE_LANES.filter((l) => !isEnabled(row.division, l))"
              :key="lane"
              type="button"
              class="lane-add"
              :disabled="!editable"
              @click="emit('toggle-lane', { division: row.division, lane })"
            >
              + {{ laneLabel(row.division, lane) }}
            </button>
          </div>

          <p v-if="row.oversubscribed" class="lane-warning">
            Lanes hold {{ row.laneTotal }} teams; division has only {{ row.teamCount }}.
          </p>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.elim-setup {
  padding: 1.5rem 0 1rem;
  border-top: 2px solid var(--color-text);
  margin-top: 1.5rem;
}

.section-head {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}

.section-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.55rem;
  margin: 0;
  letter-spacing: -0.015em;
  color: var(--color-heading);
  flex-shrink: 0;
}

.section-meta {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.5rem;
}

.rule {
  color: var(--color-border);
}

.draft-badge {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-bg);
  background: var(--color-text);
  padding: 0.15rem 0.45rem;
  margin-left: auto;
  align-self: center;
}

.divisions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.division {
  display: grid;
  grid-template-columns: minmax(0, 14rem) minmax(0, 1fr);
  gap: 1.5rem;
  padding: 1.25rem 0;
  border-top: 1px solid var(--color-border-alt);
}

.division:first-child {
  border-top-color: var(--color-border);
}

.division-head {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.division-name {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 1.4rem;
  line-height: 1.05;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--color-text);
}

.division-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 0.85rem;
  margin: 0;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.stat dt {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin: 0;
}

.stat dd {
  font-family: var(--font-mono);
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
  margin: 0;
  line-height: 1;
}

.lanes {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.single-lane {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem 0.85rem;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--color-border-alt);
}

.lane-bar {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  overflow: hidden;
  min-height: 4.5rem;
  position: relative;
  user-select: none;
}

.lane-bar.is-disabled {
  opacity: 0.7;
}

.lane-segment {
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
  padding: 0.6rem 0.9rem;
  min-width: 0;
  background: var(--color-bg);
  overflow: hidden;
}

.lane-segment--main {
  background: var(--color-bg-raised);
}

.lane-segment + .lane-segment {
  border-left: 1px solid var(--color-border);
}

.lane-name {
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lane-segment-count {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 1.4rem;
  font-weight: 500;
  color: var(--color-text);
  margin-top: 0.1rem;
  line-height: 1;
}

.lane-segment-est {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-top: 0.2rem;
}

.lane-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.lane-size,
.lane-est {
  font-size: 0.95rem;
  color: var(--color-text);
}

.lane-stat-label {
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-faint);
}

.lane-rule {
  color: var(--color-border);
  margin: 0 0.2rem;
}

.lane-remove {
  position: absolute;
  top: 0.25rem;
  right: 0.4rem;
  background: none;
  border: none;
  font: inherit;
  font-family: var(--font-mono);
  font-size: 1rem;
  line-height: 1;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0 0.2rem;
}

.lane-remove:hover {
  color: var(--color-invalid, #c00);
}

.lane-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1.4rem;
  /* `left: X%` is set inline; translate centres the button on that
     point. Using transform instead of negative margin-left avoids the
     box-model quirks that bit me earlier (margin-left applied AFTER
     left can be sensitive to box-sizing and to layout reflow during
     drag). */
  transform: translateX(-50%);
  background: transparent;
  border: none;
  padding: 0;
  cursor: ew-resize;
  pointer-events: auto;
  touch-action: none;
  appearance: none;
  -webkit-appearance: none;
  z-index: 2;
}

/* Full-height divider line — the boundary between two lanes. */
.lane-handle::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  margin-left: -1px;
  width: 2px;
  background: var(--color-text);
}

/* Grip pill at the centre with two inner notches drawn as inset shadows.
   Pure CSS — no glyph fallback risk. */
.lane-handle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 0.7rem;
  height: 1.65rem;
  background: var(--color-text);
  border-radius: 2px;
  box-shadow:
    inset 1.5px 0 0 var(--color-bg),
    inset -1.5px 0 0 var(--color-bg);
}

.lane-handle:hover::before,
.lane-handle:focus-visible::before {
  background: var(--color-accent);
}

.lane-handle:hover::after,
.lane-handle:focus-visible::after {
  background: var(--color-accent);
}

.lane-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.lane-add {
  background: none;
  border: none;
  font: inherit;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 0.3rem 0;
  text-align: left;
}

.lane-add:hover:not(:disabled) {
  color: var(--color-text);
}

.lane-add:disabled {
  cursor: default;
  opacity: 0.4;
}

.lane-warning {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--color-invalid, #c00);
  margin: 0;
}

@media (max-width: 640px) {
  .division {
    grid-template-columns: 1fr;
  }
}

@media print {
  .draft-badge,
  .lane-add,
  .lane-remove,
  .lane-handle {
    display: none;
  }
}
</style>
