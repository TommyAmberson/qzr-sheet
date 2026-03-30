<script setup lang="ts">
const scoresheetUrl = __SCORESHEET_URL__
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="hero">
      <div class="container">
        <div class="hero-content">
          <h1 class="hero-heading">
            Bible Quiz tools for<br />
            <span class="hero-highlight">coaches and officials</span>
          </h1>
          <p class="hero-sub">
            Free, offline-first scoresheet for live quizzes. Works in the browser or as a desktop
            app on Windows, macOS, and Linux.
          </p>
          <div class="hero-actions">
            <a :href="scoresheetUrl" class="btn btn--primary">Open Scoresheet</a>
            <a
              href="https://github.com/TommyAmberson/qzr-sheet/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn--secondary"
            >
              Download Desktop App
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="features">
      <div class="container">
        <h2 class="section-heading">Everything you need at a quiz meet</h2>
        <div class="feature-grid">
          <div class="feature-card">
            <div class="feature-icon">⚡</div>
            <h3 class="feature-title">Live scoring</h3>
            <p class="feature-desc">
              Click any cell to record correct answers, errors, fouls, and bonuses. Scores update
              instantly across all quizzers and teams.
            </p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">✈️</div>
            <h3 class="feature-title">Offline-first</h3>
            <p class="feature-desc">
              No internet required. Auto-saves to local storage so you never lose work. Export to
              JSON or ODS for record-keeping.
            </p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">📋</div>
            <h3 class="feature-title">Full rule support</h3>
            <p class="feature-desc">
              Toss-ups, bonuses, A/B columns, foul-outs, 20-question overtime — every rule from the
              official rulebook is modelled and validated.
            </p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">🖥️</div>
            <h3 class="feature-title">Web + Desktop</h3>
            <p class="feature-desc">
              Use the PWA from any browser, or install the native desktop app on Windows, macOS, or
              Linux for file-system access and offline reliability.
            </p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">⌨️</div>
            <h3 class="feature-title">Keyboard-driven</h3>
            <p class="feature-desc">
              Full keyboard navigation, undo/redo, and shortcuts for save, open, and new quiz. Move
              fast without reaching for the mouse.
            </p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">🆓</div>
            <h3 class="feature-title">Free and open source</h3>
            <p class="feature-desc">
              No account required. No ads. No tracking. The source code is on GitHub for anyone to
              inspect, fork, or contribute to.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Download CTA -->
    <section class="download">
      <div class="container">
        <div class="download-inner">
          <div class="download-text">
            <h2 class="download-heading">Install the desktop app</h2>
            <p class="download-sub">
              Native file dialogs, no browser required, works fully offline. Installers available
              for Windows, macOS, and Linux from GitHub Releases.
            </p>
          </div>
          <a
            href="https://github.com/TommyAmberson/qzr-sheet/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn--primary"
          >
            Download latest release
          </a>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.container {
  max-width: 72rem;
  margin: 0 auto;
  padding: 0 1.5rem;
}

/* Hero */
.hero {
  padding: 5rem 0 4rem;
  background: var(--color-bg-warm);
}

.hero-content {
  max-width: 44rem;
}

.hero-heading {
  font-size: clamp(2rem, 5vw, 3rem);
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.03em;
  color: var(--color-heading);
  margin-bottom: 1.25rem;
}

.hero-highlight {
  color: var(--color-accent);
}

.hero-sub {
  font-size: 1.125rem;
  color: var(--color-text-muted);
  max-width: 36rem;
  margin-bottom: 2rem;
}

.hero-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.6rem 1.25rem;
  border-radius: 7px;
  font-size: 0.9rem;
  font-weight: 600;
  text-decoration: none;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s,
    opacity 0.15s;
  white-space: nowrap;
}

.btn--primary {
  background: var(--color-accent);
  color: var(--color-bg);
  border: 1px solid var(--color-accent);
}

.btn--primary:hover {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
  color: var(--color-bg);
  text-decoration: none;
}

.btn--secondary {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

.btn--secondary:hover {
  border-color: var(--color-text-muted);
  color: var(--color-text);
  text-decoration: none;
}

/* Features */
.features {
  padding: 4rem 0;
  background: var(--color-bg);
}

.section-heading {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--color-heading);
  margin-bottom: 2.5rem;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: 1.5rem;
}

.feature-card {
  padding: 1.5rem;
  border: 1px solid var(--color-border-alt);
  border-radius: 10px;
  background: var(--color-bg-raised);
}

.feature-icon {
  font-size: 1.5rem;
  margin-bottom: 0.75rem;
  line-height: 1;
}

.feature-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-heading);
  margin-bottom: 0.5rem;
}

.feature-desc {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  line-height: 1.6;
}

/* Download CTA */
.download {
  padding: 3.5rem 0;
  background: var(--color-bg-warm);
  border-top: 1px solid var(--color-border-alt);
}

.download-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  flex-wrap: wrap;
}

.download-text {
  max-width: 36rem;
}

.download-heading {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-heading);
  margin-bottom: 0.5rem;
}

.download-sub {
  font-size: 0.9rem;
  color: var(--color-text-muted);
}
</style>
