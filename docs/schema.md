# Public research schema

Version `1.0.0` defines one pseudonymous participant-day observation. Ratings
are integers from 0 (none/lowest) through 4 (most/highest). Missing nullable
context is represented as JSON `null`, never a sentinel such as `-1`.

`participant_id` is a random research identifier, not an application account
identifier. `day_in_study` starts at zero and preserves intervals without
exposing calendar dates. The schema uses `additionalProperties: false` to
prevent accidental export of unreviewed fields.

The optional `activity_minutes` field supports local research-dataset adapters.
It is not collected by the v1 mobile alpha. `source` records provenance without
embedding a filename or institution identifier.

Examples in `synthetic-example-records.json` are hand-authored simulations and
contain no tester or mcPHASES information. A schema addition requires a semantic
version change and a privacy review.
