export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Classic git mailing-list widths (50/72) instead of the
    // config-conventional default of 100/100.
    //
    // Header is error-level: subjects are short, easy to control,
    // and the most visible part of `git log --oneline`. Body and
    // footer are warning-level because legitimate exceptions exist
    // (quoted URLs, stack traces, long issue refs).
    'header-max-length': [2, 'always', 50],
    'body-max-line-length': [1, 'always', 72],
    'footer-max-line-length': [1, 'always', 72],
  },
}
