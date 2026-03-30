<script setup lang="ts">
const scoresheetUrl = __SCORESHEET_URL__
</script>

<template>
  <header class="header">
    <div class="header-inner">
      <RouterLink to="/" class="logo">
        <span class="logo-mark">qzr</span>
        <span class="logo-name">VerseVault</span>
      </RouterLink>
      <nav class="nav">
        <a :href="scoresheetUrl" class="nav-link nav-link--cta">Open Scoresheet</a>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.header {
  border-bottom: 1px solid var(--color-border-alt);
  background: var(--color-bg);
}

.header-inner {
  max-width: 72rem;
  margin: 0 auto;
  padding: 0 1.5rem;
  height: 3.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  text-decoration: none;
  color: inherit;
}

.logo:hover {
  text-decoration: none;
}

.logo-mark {
  font-size: 1.1rem;
  font-weight: 800;
  letter-spacing: -0.04em;
  color: var(--color-accent);
  font-family: 'Segoe UI', system-ui, sans-serif;
}

.logo-name {
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--color-text-muted);
}

.nav {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.nav-link {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-muted);
  text-decoration: none;
  transition: color 0.15s;
}

.nav-link:hover {
  color: var(--color-text);
  text-decoration: none;
}

.nav-link--cta {
  padding: 0.4rem 0.9rem;
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  color: var(--color-accent);
  transition:
    background 0.15s,
    color 0.15s;
}

.nav-link--cta:hover {
  background: var(--color-accent);
  color: var(--color-bg);
  text-decoration: none;
}
</style>
