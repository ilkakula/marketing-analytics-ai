# Sample CSV files

Ready-made files to try the import (Import page, or `POST /api/imports/csv`). Dates end on 2026-11-03, so use
the **Last 30 days** range (or **All time**) to see them on the dashboard. Importing into the demo workspace adds
new campaigns next to the seeded ones; use a fresh account to see them alone.

| File | Rows | What it demonstrates | Expected result |
|---|---|---|---|
| `01-valid-basic.csv` | 168 | The standard format: 3 campaigns x 2 ad sets x 2 ads x 14 days | `completed`, 168 imported |
| `02-with-errors.csv` | 13 | Impossible date, negative spend, text instead of a number, clicks above impressions, empty campaign, fractional conversions, duplicate row | `completed_with_errors`: 6 imported, 7 rejected, each with row, column and reason |
| `03-european-semicolon.csv` | 20 | `;` separator, decimal comma (`12,50`) and a UTF-8 BOM, as Excel exports in many European locales | `completed`, 20 imported |
| `04-meta-ads-export.csv` | 168 | Column names like a Meta Ads Manager export (`Day`, `Campaign name`, `Amount spent (USD)`, `Link clicks`, `Results`...) | First `400 Missing required columns`; the mapping panel then imports it (map Ad set / Ad too) |
| `05-campaign-level-only.csv` | 63 | No `ad_set` / `ad` columns: they default to `(unassigned)` | `completed`, 63 imported |
| `06-large-30k-rows.csv` | 30,000 | Performance and batching (1.7 MB, 125 campaigns x ads x 60 days) | `completed`, 30,000 imported in a couple of seconds |
| `07-edge-cases.csv` | 8 | Commas and quotes in names, formula injection (`=HYPERLINK(...)`, `+SUM(...)`), zero spend, zero impressions, non-ASCII text, extra whitespace, a very long name | `completed`; **Export CSV** neutralizes the formula cells with a leading apostrophe |
| `08-missing-column.csv` | 5 | A required column (`conversions`) is absent | `400 Missing required columns: conversions` |

## Column mapping for `04-meta-ads-export.csv`
| Field | Column in the file |
|---|---|
| date | `Day` |
| campaign | `Campaign name` |
| ad_set (optional) | `Ad set name` |
| ad (optional) | `Ad name` |
| spend | `Amount spent (USD)` |
| clicks | `Link clicks` |
| conversions | `Results` |
| revenue | `Purchase conversion value` |

`impressions` already matches by name.

## Using real data
- **Meta Ads Manager:** Reports > Export > CSV, with the breakdown **By day** and the columns above.
- **Google Ads:** Reports > Download > CSV, segmented by **Day**; map `Cost`, `Impressions`, `Clicks`, `Conversions` and `Conv. value`.
- The file needs a **date column** (one row per ad per day) and a **revenue column**. Exports without a date (some public Kaggle
  ad datasets are aggregated per ad) cannot be imported as they are: add a date column first.
