<template>
  <div class="page">
    <div class="container">
      <section class="section">
        <h2 class="section-title">Available now</h2>
        <dl class="feature-list">
          <div class="feature-item">
            <dt class="feature-name">Scoresheet</dt>
            <dd class="feature-desc">
              Score quizzes offline in the browser or as a desktop app. Full rule support: toss-ups,
              A/B columns, fouls, bonuses, and overtime. No account needed.
            </dd>
          </div>
          <div class="feature-item">
            <dt class="feature-name">QuizMeets</dt>
            <dd class="feature-desc">
              Join a meet with a code. Coaches build team rosters; officials are assigned to rooms.
              Sign in to link the scoresheet to your meet and load teams automatically.
            </dd>
          </div>
          <div class="feature-item">
            <dt class="feature-name">Division support</dt>
            <dd class="feature-desc">
              Prelim and consolation divisions tracked per team. The scoresheet's division dropdown
              filters the team picker automatically when linked to a meet.
            </dd>
          </div>
        </dl>
      </section>

      <section class="section">
        <h2 class="section-title">Coming soon</h2>
        <dl class="feature-list">
          <div class="feature-item">
            <dt class="feature-name">Results submission</dt>
            <dd class="feature-desc">
              Officials submit completed scoresheets directly to the meet. No more emailing
              spreadsheets.
            </dd>
          </div>
          <div class="feature-item">
            <dt class="feature-name">Stats</dt>
            <dd class="feature-desc">
              Team and individual totals computed from submitted results: points, correct/incorrect
              counts, and placement finishes.
            </dd>
          </div>
          <div class="feature-item">
            <dt class="feature-name">Schedule</dt>
            <dd class="feature-desc">
              Round-robin schedule generation and publishing. Coaches and viewers see their quizzes
              once the schedule is published.
            </dd>
          </div>
          <div class="feature-item">
            <dt class="feature-name">Guest access</dt>
            <dd class="feature-desc">
              Join with just a code — no account required. Officials and viewers can participate
              without signing in.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding: 2.5rem 0;
}

.container {
  max-width: 48rem;
  margin: 0 auto;
  padding: 0 1.5rem;
}

.section {
  margin-bottom: 2.5rem;
}

.section-title {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-bottom: 1rem;
}

.feature-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.feature-item {
  display: grid;
  grid-template-columns: 10rem 1fr;
  gap: 0 1.25rem;
  align-items: baseline;
}

.feature-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
}

.feature-desc {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin: 0;
}

@media (max-width: 480px) {
  .feature-item {
    grid-template-columns: 1fr;
    gap: 0.2rem;
  }
}
</style>
