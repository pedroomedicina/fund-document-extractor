# Roadmap

Build one thin path end to end, measure it, show it, then widen. Why this order: [decision 0009](decisions/0009-thin-evaluated-slice-first.md).

Estimates assume one person at about 8 hours a week. Hours are focused work; weeks are calendar time.

| Phase | Goal                                                                | Estimate               |
| ----- | ------------------------------------------------------------------- | ---------------------- |
| 0–1   | Corpus, ingestion, chunking, storage, hybrid search                 | Done                   |
| A     | Extract three fields, each with a quote checked on its cited pages  | 30–35 h, about 4 weeks |
| B     | A reproducible results table against a baseline, failures explained | 45–55 h, 6–7 weeks     |
| C     | A read-only public demo and a 90-second video                       | 20–25 h, about 3 weeks |
| D     | A case study, a 5-minute review guide, an expert check of labels    | 15–20 h, 2–3 weeks     |
| E     | The other three fields, CI eval gate, review UI, more documents     | 2–4 weeks per item     |

A to D is about 115–135 hours, roughly 3.5 to 4 months. The first number a reviewer can check (the interim table in Phase B) arrives around week 7.

**Old phase names.** Records 0005, 0006 and 0008 refer to the plan before 0009. Old Phase 2 (six fields, review UI, extraction endpoints) became Phase A (three fields) and Phase E (the rest). Old Phase 3 (evaluation with a CI gate) became Phase B (evaluation) and Phase E (the gate). "Public deployment" became Phase C.

**Postponed until after E:** document upload, login, other document types (capital call notices, NVCA documents, SAFEs, side letters), and further ingestion polish (KB-1, PDF repair).

---

## Phase A: thin extraction

**Goal:** one command extracts `management_fee`, `carried_interest` and `preferred_return` from an ingested LPA, and every value marked `found` has a quote that was checked on its cited pages.

**Tasks**

1. **Labelling guide v1 and value schemas.** Write them before the prompt, because the extractor's output and the labels must mean the same thing. Cover fee step-downs and basis (committed or invested capital), carry catch-up, hurdles stated as a multiple (NB Crossroads: 125% of contributions), terms defined in one article and used in another, and how values are normalised. Label a **dev set**: the three EDGAR LPAs plus two ILPA model LPAs (bracketed blanks, so `placeholder`). The dev set is for building and is never reported.
2. **LLM client** behind an `Llm` interface. Every call is written to `llm_calls` with tokens, cost and latency, and the `LLM_MONTHLY_BUDGET_USD` cap is enforced before a call is made.
3. **Retrieval per field.** Search terms that include each document's own defined terms. Leave table-of-contents chunks out (this amends 0008). Pull in the Definitions entry for a defined term the clause uses, and sections it cites through `sectionRefs`.
4. **One structured-output call per field**, returning value, page range, quote and status.
5. **The validator.** `containsQuote` exists; the rest doesn't yet:
   - join the pages in the cited range, with printed page numbers, headers and footers removed, so a quote across a page break can match;
   - require a minimum quote length, so a bare "20%" can't pass;
   - require the value to appear in the quote, in any of its written forms ("2%", "two percent (2%)", "200 basis points");
   - detect bracketed placeholders (`[●]%`) and return `placeholder`.
6. **One retry** with the validator's errors, then `needs_review` with `validation_errors` stored.
7. `npm run extract -- --doc <id>` writes one extraction run. Tests with a fake LLM cover every path.
8. A Phase A walkthrough and the Phase A decision records (below).

**Done when**

- [ ] On the dev set, every field ends as `found`, `not_found`, `placeholder` or `needs_review`, never silently.
- [ ] Tests prove that an invented quote, a changed number or a wrong page is never `found`.
- [ ] Cost and latency are recorded per call, and the budget cap refuses calls over the limit.
- [ ] Each decision record is in the same change as its code.
- [ ] Dev-set results are in the walkthrough, not the README.

---

## Phase B: evaluation

**Goal:** a reproducible table that says how often the pipeline is right, compared with a baseline, with every failure explained.

**Tasks**

1. **Sourcing spike, capped at 8 hours.** Most LPAs on EDGAR are for MLPs and REIT operating partnerships, which have no fee or carry; fund LPAs appear as exhibits from public sponsors or investors, registered funds of funds and SBICs. Screen candidates, then pin about 15 held-out LPAs from at least six template families in `corpus/sources.json`. Write `scripts/corpus-candidates.ts` or document the manual search. Fewer than about 10 usable LPAs means revisiting 0009.
2. **Labelling guide v2** from what the dev set taught, then **freeze it** before labelling held-out documents.
3. **Label blind,** before running anything on those documents: value, pages and verbatim quote, or `not_found`. Time each document.
4. **Eval harness.** Run the pipeline and the baseline (the same model given the whole document, with the same output schema and the same quote check), record every LLM response so a run can be replayed, and score.
5. **Report**, per field and per template family, as counts (`13/15`), not only percentages:
   - correct values;
   - review rate (share of fields sent to a human);
   - verified-but-wrong: the quote is real but the value is wrong, for example the step-down rate given as the headline rate;
   - quotes that fail the check before the retry and after it, for the pipeline and the baseline (after the check, an accepted invented quote is 0 by construction, so it is a test, not a metric);
   - how often the retry fixed the problem;
   - cost and latency per document.
6. **Failure analysis:** a cause for every wrong or `needs_review` field (retrieval missed it, wrong clause, normalisation, quote check too strict, label error).
7. **README:** the table at the top, with the failures and the commit it was produced from.
8. **Start the expert outreach** for Phase D now: replies take weeks.

**Interim milestone:** publish the table on the first six held-out documents, about three weeks in, marked as interim.

**Done when**

- [ ] At least 12 held-out LPAs are labelled under the frozen guide, none of them used during Phase A.
- [ ] One command rebuilds the report from recorded responses, without API calls.
- [ ] The table is at the top of the README with counts, failures and the commit hash.
- [ ] Every miss has a cause.
- [ ] Phase B walkthrough and decision records are written.

---

## Phase C: demo

**Goal:** a stranger opens a link and checks a value against its page in under a minute.

**Tasks**

1. Export the scored run to static JSON, for EDGAR documents only (`public_demo: true`).
2. A page with the preloaded LPAs: pick one, see the three fields with their status, click a field to jump to its page with the quote highlighted (pdf.js, as in 0003), with a link to the filing.
3. Deploy. No upload, no login.
4. A 90-second video walkthrough, linked from the README.

**Done when**

- [ ] The link works logged out, on desktop and phone.
- [ ] The values shown come from the same run as the README table.
- [ ] A check fails the build if any ILPA content would be deployed.
- [ ] The page needs no API key and no database at runtime.
- [ ] The video is 90 seconds or less.

---

## Phase D: hiring evidence

**Goal:** a reviewer understands the problem, the choices and the results in five minutes, and someone who works with LPAs has checked the labels.

**Tasks**

1. `docs/case-study.md`: the problem, the design decisions and why (linking the records), the eval results, the failures, and what I'd do next.
2. A README section, "Review this repo in 5 minutes", pointing to the eval table, the demo, the video and the three or four records most worth reading.
3. An expert check: one or two people who work with LPAs review a sample of 10–15 labels. Report agreement as a count, fix labels they show are wrong, and re-score. This is about credibility, not a sales pilot.
4. Ask someone who hasn't seen the repo to do the five-minute review, and time it.

**Done when**

- [ ] The case study and the five-minute section are published.
- [ ] The expert agreement count is in the README, whatever it is.
- [ ] Someone new got through the five-minute review in five minutes.

---

## Phase E: widen

Each item is its own small slice: guide first, then labels, code, and a re-run of the eval.

- `investment_period`, `key_person`, `clawback`.
- An eval gate in CI, running on recorded responses so it needs no API key.
- A review UI on the `reviews` table.
- More documents and template families.

**Done when** (per item): the README table is updated, and the item's decision record is written.

---

## Decision records to write

Each is written in the same change as its code ([rules](decisions/README.md)). Numbers are assigned in the order they are written, so the list below has none.

| Phase | Decision                                    | Likely interview question                                        | Alternatives worth comparing                                                                                                                                   |
| ----- | ------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Which LLM extracts, and which client        | "Why this model? What would a cheaper one lose?"                 | A mid-tier and a frontier model from one provider; another major provider; a long-context model; open weights hosted yourself. Confirmed by Phase B's numbers. |
| A     | Structured output, one call per field       | "What happens when the model returns broken JSON?"               | JSON-schema or tool-call output vs parsing free text; one call for all fields vs one per field                                                                 |
| A     | Field value schemas and normalisation       | "Is 2% of commitments the same value as 2% of invested capital?" | A single number vs a structured value (rate, basis, step-down); a hurdle as a rate vs a multiple                                                               |
| A     | Retrieval per field (amends 0008)           | "How do you know the right clause was in the prompt?"            | Fixed top-k vs the whole article; following section references; defined-term lookup; leaving the table of contents out                                         |
| A     | Quote validation rules                      | "Why exact match and not fuzzy?"                                 | A fuzzy threshold; embedding similarity; an LLM judge; character offsets instead of quotes; one quote vs several per field                                     |
| A     | Retry policy, statuses and confidence       | "Why one retry? What does 0.8 confidence mean?"                  | No retry, one, or several; a retry with new retrieval; the model's own confidence vs agreement between two samples vs showing none                             |
| B     | Eval corpus and dev / held-out split        | "Did you tune on your test set? Is 15 documents enough?"         | One pool vs a split; counting by document vs by template family                                                                                                |
| B     | Format and location of the answer key       | "How do labels stay valid if a filing changes?"                  | JSONL in git pinned by fingerprint; a database table; a spreadsheet; a labelling tool. ILPA labels can't be committed (0002).                                  |
| B     | Labelling rules                             | "How did you label a fee that steps down?"                       | Cite the definition vs the clause that applies it; how step-downs, catch-up and silent documents are labelled                                                  |
| B     | What counts as a correct value, and metrics | "Isn't zero invented quotes true by construction?"               | Exact match on the structured value vs per sub-field vs an LLM judge; page overlap vs quote overlap                                                            |
| B     | Baseline                                    | "Did retrieval actually help?"                                   | The whole document with the same model; a frontier model; regex or keywords; the pipeline without the retry                                                    |
| B     | Recording and replaying LLM calls           | "Can I reproduce your table?"                                    | Re-running live; temperature 0 only; recorded responses (`llm_calls.outcome` already allows `replayed`)                                                        |
| C     | Where and how the demo is hosted            | "Is the demo running your pipeline live?"                        | A static export on a static host vs an API with Postgres on a container host                                                                                   |
| C     | Showing pages and highlighting quotes       | "What if the quote spans two pages?"                             | Searching the pdf.js text layer vs stored character offsets; page images vs the whole PDF (licences: 0002)                                                     |
| D     | How the expert label check works            | "How do you know your labels are right?"                         | Sample size; blind vs shown my label; how a disagreement changes the label                                                                                     |
| E     | Eval gate in CI                             | "What stops a prompt change from making it worse?"               | Recorded responses vs live calls; a threshold per field vs overall                                                                                             |

## Questions each phase should be ready for

| Phase | Question                                                  | Answered by                                    |
| ----- | --------------------------------------------------------- | ---------------------------------------------- |
| A     | "Why only three fields?"                                  | 0009                                           |
| A     | "What happens if the quote isn't on the page?"            | Quote validation, retry policy                 |
| A     | "Why this model and not a cheaper one?"                   | LLM choice, confirmed by the Phase B table     |
| B     | "Did you label before you saw the model's output?"        | Eval corpus and split, labelling rules         |
| B     | "Did retrieval beat giving the model the whole document?" | Baseline                                       |
| B     | "Zero invented quotes: isn't that guaranteed?"            | What counts as correct, and metrics            |
| C     | "Is this live or precomputed?"                            | Demo hosting                                   |
| C     | "How does the highlight find a quote that spans pages?"   | Showing pages, quote validation                |
| C     | "Are you allowed to show these documents?"                | 0002                                           |
| D     | "How do you know your labels are right?"                  | Expert label check                             |
| D     | "Why not a pilot with a real fund?"                       | 0009                                           |
| D     | "What would you do next?"                                 | Case study; 0008 (reranker, larger embeddings) |
| E     | "How do you stop regressions?"                            | Eval gate in CI, recording and replay          |
| E     | "Why did the review UI come last?"                        | 0009                                           |

## Risks

- **Not enough usable EDGAR LPAs.** Of the three in the corpus, one has conventional terms. The sourcing spike comes first in Phase B, with 12 held-out documents as the minimum.
- **Small numbers.** With 15 documents, one error moves a field's accuracy by about 7 points, so results are reported as counts.
- **The baseline may win** on 40–60 page documents. The table is published either way; "as accurate and cheaper" is a result too.
- **Budget.** Whole-document baseline runs cost more than retrieval runs. Estimate before running, raise the cap for the eval month if needed, and rely on replay for reruns.
- **Licences.** ILPA text stays out of git and off the demo; its results are reported as counts only (0002).

## Terms

- **LPA:** the contract of a private fund between the manager (general partner, GP) and the investors (limited partners, LPs).
- **Management fee:** the yearly fee paid to the manager, as a rate on committed or invested capital. A **step-down** lowers it after the **investment period**, the years in which the fund makes new investments.
- **Carried interest (carry):** the manager's share of profits, often 20%.
- **Preferred return (hurdle):** what investors receive before any carry, often 8% a year, sometimes a multiple of capital.
- **Catch-up:** after the hurdle, the manager receives most or all profits until it has its full carry share.
- **Defined term:** a capitalised term ("Preferred Return") defined once, usually in a Definitions article, and used throughout.
- **Dev set / held-out set:** documents used to build the extractor vs documents used only to score it.
- **Baseline:** a simpler approach to compare against. Here, the same model given the whole document with no retrieval.
- **Review rate:** the share of fields sent to a human instead of accepted.
