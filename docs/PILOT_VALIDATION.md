# Pilot measurement and review

The report center accepts explicitly **user-entered** baseline manual labor minutes and
DUMPWISE workflow labor minutes, each 0–10080 with at most two decimals. Compare the same
task, reporting scope and review obligations. Include operator attention, correction and
review effort; distinguish elapsed machine processing from employee labor.

`manualMinutes - automatedMinutes` is an exact signed labor-minute difference. Negative
values mean the entered DUMPWISE workflow took more labor. No denominator or percentage
is required, so zero baselines are not divided by zero. These inputs are not independently
verified timings, monetary savings, ROI or a claim that automation caused an improvement.

POST `/v1/reports/:id/pilot` appends an assessment. It includes a statement about whether
both exports were reviewed and up to 20 bounded discrepancy notes with OPEN/RESOLVED
status. A later assessment can document a resolution without erasing earlier statements.
History is tenant-scoped and paginated, and audit events record actor/report linkage and
counts without copying discrepancy descriptions into logs.

The evidence view shows two generated formats, source batch count, activity months,
accepted/rejected whole-batch row counts and passed/total stored reconciliation checks.
No checks means a null pass percentage, not 100%. These figures describe the frozen
report's contributing published batches, including comparison sources; they do not estimate
the failure rate of all attempted imports or prove complete SAP extract coverage.

An assessment's review checkbox is a human statement about both formats, not a tracked
per-file approval or proof that someone read them. Download events and full workflow
durations are not automatically measured. Discrepancy notes are assessment history,
not a ticketing system with assignees/SLA controls. Do not enter real company information.

## Pilot acceptance worksheet

1. Agree a synthetic/redacted source, approved mapping, independent controls and expected
   business output. Obtain an approved company example before any company-format claim.
2. Preview and explain rejected/duplicate records. Import and reconcile; OWNER publishes.
3. Trace dashboard totals to contributing items and batch checks, separately by currency/unit.
4. Generate both formats from one snapshot; compare exact totals and source evidence.
5. Review the actual Office layouts and editability in the intended environment.
6. Enter comparable measured labor durations and review/discrepancy statements.
7. Record unresolved data, UX, storage, operations and security gates before considering
   a real pilot. No real company data is authorized in this local development environment.

## Learning milestone: product evidence

The UI collects a business statement, the API validates bounded DTOs and actual role
permissions, and PostgreSQL preserves append-only tenant-owned history. A measurement
must state its provenance; a quick demo is not evidence of saved employee time.

Exercise: enter a zero baseline and a longer automated workflow, then explain the negative
minute difference without describing it as negative financial ROI.

Interview questions: Why separate labor time from elapsed machine time? Why retain an
earlier unresolved discrepancy statement after recording a resolution?
