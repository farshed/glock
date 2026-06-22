<div align="center">
  <img src="assets/glock_logo_optimized.png" alt="Glock logo" width="200" />
  <h1>Glock</h1>
  <p>GitHub lines-of-code counter.</p>
</div>

---

Glock is a Chrome extension that displays LOC on GitHub repos. It uses [tokei](https://github.com/XAMPPRocky/tokei) behind the scenes for counting.

## Caching

Counts are cached so results stay fast. Large repositories are cached for **24
hours**, while smaller ones refresh every **few minutes**.

Because of this, the badge may not reflect a brand-new commit right away — give
it a little time and it will update on its own.
