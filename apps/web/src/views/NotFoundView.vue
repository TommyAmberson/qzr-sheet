<template>
  <div class="page">
    <div class="container">
      <h1 class="title">Page not found</h1>
      <p class="message">There's nothing at this address.</p>
      <RouterLink to="/" class="home-link">Back to qzr</RouterLink>
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

.title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 0.5rem;
}

.message {
  color: var(--color-text-muted);
  margin-bottom: 1.5rem;
}

.home-link {
  color: var(--color-accent);
}
</style>
