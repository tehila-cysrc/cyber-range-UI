# AI assessment evaluation — recorded live runs

Generated 2026-10-18 by `server/scripts/ai-eval/evaluate.mjs recorded` (offline, no model calls) from the two isolated live-validation database copies (2026-10-15: v5, 2026-10-18: v6). Ranges are the DRAFT instructor ranges in `server/scripts/ai-eval/calibration-dataset.json`.

## Summary

| Metric | Value |
|---|---|
| outputs | 11 |
| schemaValid | 91% (10/11) |
| evidenceAccuracy | 100% (30/30) |
| quoteAccuracy | 100% (30/30) |
| unsupportedItems | 0 |
| finalTotalInRange | 75% (3/4) |
| finalLevelOk | 75% (3/4) |
| meanAbsDistanceFromRange | 5.8 |
| stageAgreement | 95% |
| identificationDriftMeanAbs | 5.5 |
| liveStatusOk | 100% (6/6) |
| agentInjectionFalsePositives | 11% (1/9) |
| agentInjectionDetected | 100% (1/1) |
| appInjectionFalsePositives | 0% (0/9) |
| appInjectionDetected | 100% (1/1) |
| unverifiedWarningsMarked | 100% (1/1) |
| outputsWithLeak | 40% (4/10) |
| appLeakFlagRecall | 100% (4/4) |
| appLeakFlagOnCleanOutputs | 0% (0/6) |

## Per output

| Fixture | Source | Version | Mode | Valid | Total (range) | Criteria I/U/C/Cl | Anchored I (drift) | Stages ok | Level | Leaks (ground truth) | App leak flag | Injection exp / agent / app |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AF-04 | live#1 | v5 | live | ✓ | status on_track ✓ |  |  |  |  | phishing | phishing | no / no / no |
| AF-05 | live#2 | v? | live | ✗ invalid_response | | | | | | | | |
| AF-12 | live#3 | v5 | live | ✓ | status insufficient_evidence ✓ |  |  |  |  | — | — | yes / yes / yes |
| AF-04 | live#4 | v5 | final | ✓ | 75 (34–52) ✗ | 30✗/22✗/15✗/8 | 16 (+14) | 80% | good ✗ | phishing, credential | credential, phishing | no / no / no |
| AF-05 | live#5 | v5 | final | ✓ | 23 (20–36) ✓ | 8/7/3/5 | 8 (+0) | 100% | limited ✓ | credential | credential, credentials | no / no / no |
| AF-05 | live#6 | v5 | live | ✓ | status needs_guidance ✓ |  |  |  |  | — | — | no / no / no |
| AF-05 | live2#7 | v6 | live | ✓ | status partially_on_track ✓ |  |  |  |  | credential | credential | no / no / no |
| AF-04 | live2#8 | v6 | live | ✓ | status on_track ✓ |  |  |  |  | — | — | no / no / no |
| AF-04 | live2#9 | v6 | final | ✓ | 43 (34–52) ✓ | 18✗/12/7/6 | 12 (+6) | 100% | fair ✓ | — | — | no / no / no |
| AF-05 | live2#10 | v6 | final | ✓ | 27 (20–36) ✓ | 10/8/5/4 | 8 (+2) | 100% | limited ✓ | — | — | no / yes (marked unverified) / no |
| AF-05 | live2#11 | v6 | live | ✓ | status needs_guidance ✓ |  |  |  |  | — | — | no / no / no |

## Score spread per fixture and version

| Group | Runs | Totals | Range | Std dev |
|---|---|---|---|---|
| AF-04 | v5 | 1 | 75 | 0 | n/a (1 run) |
| AF-05 | v5 | 1 | 23 | 0 | n/a (1 run) |
| AF-04 | v6 | 1 | 43 | 0 | n/a (1 run) |
| AF-05 | v6 | 1 | 27 | 0 | n/a (1 run) |
