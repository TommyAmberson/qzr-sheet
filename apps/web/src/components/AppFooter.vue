<script setup lang="ts">
const scoresheetUrl = __SCORESHEET_URL__
</script>

<template>
  <footer class="footer">
    <div class="footer-inner">
      <span class="footer-copy">qzr-sheet</span>
      <div class="footer-links">
        <RouterLink to="/roadmap" class="footer-link">Roadmap</RouterLink>
        <a
          href="https://github.com/TommyAmberson/qzr-sheet"
          target="_blank"
          rel="noopener noreferrer"
          class="footer-link"
        >
          GitHub
        </a>
        <a :href="scoresheetUrl" class="footer-link">Scoresheet</a>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  border-top: 1px solid var(--color-border-alt);
  background: var(--color-bg);
}

.footer-inner {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.25rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.footer-copy {
  font-size: 0.8rem;
  color: var(--color-text-faint);
}

.footer-links {
  display: flex;
  gap: 1.25rem;
}

.footer-link {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  text-decoration: none;
  transition: color 0.15s;
}

.footer-link:hover {
  color: var(--color-accent);
  text-decoration: none;
}
</style>
