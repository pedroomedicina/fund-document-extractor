# Build a thin, evaluated slice of three fields before widening any layer

Status: accepted
Date: 26 November 2026

## Context

This repo exists to show applied AI work to reviewers at fintech, legal-tech and document-AI companies. It is not a product for customers. A reviewer gives it five to ten minutes.

The plan as written (the README status table, and the phase references in 0005, 0006 and 0008) built each layer completely: Phase 2 extracted all six fields and added a review UI, Phase 3 added an evaluation gated in CI, and public deployment came last. After Phases 0–1 the repo has a careful ingestion pipeline and no evidence that extraction works: no extractor, no labels, no numbers, nothing to click.

Constraints:

- One person working part-time, about 8 hours a week.
- Three EDGAR LPAs in the corpus, and only OCV Fund I has a conventional fee, carry and hurdle. Labelling is the slowest step, and it grows with fields × documents.
- An LLM budget of $5 a month (`LLM_MONTHLY_BUDGET_USD`).
- The Python project this is ported from made the same call (its decision 0002, "Measure retrieval before building an interface"). This port's plan had drifted back to building the interface first.

## Decision

Build one path end to end, measure it, show it, then widen:

- **Phase A:** extract `management_fee`, `carried_interest` and `preferred_return` with retrieval, a structured LLM call, the quote check, one retry with the errors, then `needs_review`. Developed against a small labelled dev set that is never reported.
- **Phase B:** score it on hand-labelled, held-out EDGAR LPAs against a whole-document baseline that uses the same model, and put the results table, failures included, at the top of the README.
- **Phase C:** a read-only demo of those same results, and a 90-second video.
- **Phase D:** a case study, a "review this repo in 5 minutes" guide, and a check of a sample of the labels by people who work with LPAs.
- **Phase E:** only then, the other three fields, the eval gate in CI, the review UI and more documents.

Upload, login, other document types and further ingestion polish wait until after E. Tasks, checklists and estimates are in [docs/roadmap.md](../roadmap.md).

## Alternatives considered

- **Keep the wide plan (all six fields and the review UI, then evaluation, then deployment):** each layer would be finished before the next starts. It lost because months pass with nothing a reviewer can check, six fields double the labelling before the first number exists, and the eval is where design mistakes show up: finding them after six fields are built means fixing six. Key person and clawback are also the hardest fields to define as a value, which is better attempted after the labelling guide has been tested on three numeric fields.
- **Deploy before evaluating:** a link is the first thing a reviewer clicks, and hosting problems surface early. It lost because a demo without numbers invites the one question it can't answer ("how often is it right?"), and a page highlighting wrong values is worse evidence than no page. The demo shows the same run the eval scores, so it comes after the eval.
- **A customer pilot instead of a hiring focus:** real users on real documents are the strongest signal there is. It lost because the repo is not a product (no upload, auth or support), and a pilot's documents and results would be confidential, so none of it could be shown. Phase D keeps the useful part, someone who reads LPAs for a living checking the labels, without the obligations.

## Consequences

- A reviewer can check a number within weeks rather than months, starting with an interim table on the first held-out documents.
- Three numeric fields keep labelling small but still exercise the hard cases: fee step-downs, carry catch-up, and terms defined in one article and used in another. "Three numbers is easy" is a fair challenge; the failure table is the answer.
- Fields that end in `needs_review` are visible in the eval and the demo, but nobody can resolve them in the app until the review UI in Phase E. The `reviews` table stays unused until then, and so does `segments`, since other document types are postponed.
- No earlier record is superseded or amended: 0001–0008 decide how things are built, not when. "Phase 2" and "Phase 3" in 0005, 0006 and 0008 refer to the old plan; [docs/roadmap.md](../roadmap.md) maps them to the new phases. The new phases use letters so the two can't be confused.
- Revisit if the sourcing step in Phase B finds fewer than about 10 usable EDGAR LPAs (shrink Phase B and say so in the README), or if a company offers a pilot (upload and login come back, each with its own record).
