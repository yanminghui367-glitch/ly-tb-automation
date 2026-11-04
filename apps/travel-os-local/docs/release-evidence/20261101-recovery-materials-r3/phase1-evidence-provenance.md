# Evidence provenance correction

The final combined-byte run of `recovery-location-independent-ui-qa.mjs` writes to a fixed `qa-phase1` output directory. It overwrote the original four screenshots and `ui-independent-result.json` there with final-version UI evidence. The copied `qa-final/location-*.png` and `location-independent-result.json` are final-run evidence only.

Original Phase 1 source bytes and test code remain sealed in `phase1-candidate/`; `qa-phase1/phase1-runtime-hashes.json`, `FINAL-QA.json`, the independent report and `final-regression.log` remain unchanged. The original Phase 1 12-check run was completed before Phase 2 and recorded in its command output, but its screenshots/result JSON original bytes were not preserved separately. Do not cite the current `qa-phase1` screenshots as the original Phase 1 render.

No historical PASS, source binding, test outcome or timestamp has been rewritten to disguise this overwrite. This is an evidence retention limitation, separate from the final candidate's successful fresh UI validation.
