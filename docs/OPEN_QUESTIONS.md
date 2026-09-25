# Open questions

Each question is a **parameter**, not a fact. The mock uses the default below. In code the value lives in
`src/domain/openQuestions.ts` (or in `MerchantConfig`, for per-merchant values), and the UI must label it **OPEN QUESTION**.
When the product owner answers, move the answer into `DECISIONS.md` and update the default.

| ID | Question | Mock default | Where it lives |
|---|---|---|---|
| OQ-01 | How do phase results combine? Does a reject in one phase outweigh a review in another? | `REJECT_WINS`: any reject → REJECTED, else any review → PENDING_REVIEW | `POLICY.phaseCombination` |
| OQ-02 | Default Auto-Pass / Auto-Reject per phase | DOCUMENT 80/60, SELFIE 80/50, FACE_MATCH 85/70, LIVENESS 90/70 | `DEFAULT_PHASE_THRESHOLDS` |
| OQ-03 | Default max attempts and cooldown per phase. Is the limit per phase or across the whole flow? | 3 attempts, 30 s cooldown, **per phase** | `DEFAULT_PHASE_THRESHOLDS` |
| OQ-04 | Claim timeout and warning time | 30 min timeout, warning 5 min before expiry | `MerchantConfig.claimTimeoutMin` / `claimWarningMin` |
| OQ-05 | Is Risk Assessment configured by a maximum allowed level (mock) or by Auto-Pass/Auto-Reject scores like other phases? Can risk auto-reject? | Max allowed level `MEDIUM`; risk never auto-rejects | `MerchantConfig.risk` |
| OQ-06 | Risk score → level bands, and risk weighting | score < 40 LOW, < 70 MEDIUM, else HIGH; weighting not modelled | `POLICY.riskBands` |
| OQ-07 | Are retakes charged per attempt? | No (one charge per verification) | `POLICY.chargePerAttempt` |
| OQ-08 | Can Platform Admin claim and decide, or only view? | Yes | `POLICY.adminCanReview` |
| OQ-09 | Final role names and permission flags (check against FRS) | `PLATFORM_ADMIN`, `MERCHANT_REVIEWER`; flags in `permissions.ts` | `src/domain/permissions.ts` |
| OQ-10 | Decision reason code list | Mock list (3 approve, 4 reject) | `REASON_CODES` |
| OQ-11 | Does a claim end when the reviewer logs out or closes the tab? | No: only Cancel, timeout or decision | `claimRules.ts` |
| OQ-12 | Can a reviewer re-claim straight after their own claim times out? | Yes | `claimRules.ts` |
| OQ-13 | What does the overlay show if the claim expires while the reviewer is typing? | Overlay disables; save fails with "Your claim expired. No changes saved." | Detail page (`ClaimBar`, `DecisionOverlay`): typed text is kept |
| OQ-14 | Unit prices per verification (by workflow version) and per retake | RM 1.50 V1 / RM 2.50 V4; RM 0.50 per user retake when OQ-07 = yes | `PRICING` |
| OQ-15 | Which 3 KPIs does the Overview show? | Total verifications, Auto-Clear (APPROVED by SYSTEM), Pending review | Overview page |
| OQ-16 | Should UAM changes (users, roles, merchants) be audited? The agreed audit action list has no UAM events | Not audited in the mock | `DEC-42` |
