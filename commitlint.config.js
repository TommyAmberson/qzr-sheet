export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Classic git mailing-list widths (50/72) instead of the
    // config-conventional default of 100/100. Error-level so
    // non-conforming messages are rejected, not just warned.
    'header-max-length': [2, 'always', 50],
    'body-max-line-length': [2, 'always', 72],
    'footer-max-line-length': [2, 'always', 72],
  },
}
