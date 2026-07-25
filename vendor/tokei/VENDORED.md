tokei 14.0.0
Upstream: https://github.com/XAMPPRocky/tokei
Base commit: fa44e5194060305576514d59b850353643afbfc8
Local branch: wasm32-support (0d7dd71bf4a90d1f7ea2f95840c56919e43357ef)

Patched for wasm32-unknown-unknown:
  1. CLI-only deps (term_size, table_formatter, clap-cargo) made optional.
  2. etcetera made optional and gated behind `cli` (it pulls in `home`,
     which does not compile for wasm).
  3. Added LanguageType::from_shebang_slice, so extensionless scripts can be
     detected without a filesystem.
Submitted upstream; replace this vendored copy with a git dependency once merged.
