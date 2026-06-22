<div align="center">
  <img src="assets/glock_logo_optimized.png" alt="Glock logo" width="200" />
  <h1>Glock</h1>
  <p>GitHub lines-of-code counter.</p>
</div>

---

Glock is a chrome extension that displays LOC on GitHub repos. It uses [tokei](https://github.com/XAMPPRocky/tokei) for counting.

## Caching

Counts for large repos are cached for 24h, while smaller ones refresh every few minutes. Because of this, the badge may not reflect brand-new commits right away.
