# Sample CSV files

Ready-made files to try the import (Import page, or `POST /api/imports/csv`). Dates end on 2026-11-03, so use
the **Last 30 days** range (or **All time**) to see them on the dashboard. Importing into the demo workspace adds
new campaigns next to the seeded ones; use a fresh account to see them alone.

| File | Rows | What it demonstrates | Expected result |
|---|---|---|---|
| `01-valid-basic.csv` | 168 | The standard format: 3 campaigns x 2 ad sets x 2 ads x 14 days | `completed`, 168 imported |
| `02-with-errors.csv` | 13 | Impossible date, negative spend, text instead of a number, clicks above impressions, empty campaign, fractional conversions, duplicate row | `completed_with_errors`: 6 imported, 7 rejected, each with row, column and reason |
| `03-european-semicolon.csv` | 20 | `;` separator, decimal comma (`12,50`) and a UTF-8 BOM, as Excel exports in many European locales | `completed`, 20 imported |
| `04-meta-ads-export.csv` | 168 | Column names like a Meta Ads Manager export (`Day`, `Campaign name`, `Amount spent (USD)`, `Link clicks`, `Results`...) | `completed`: recognized automatically as a Meta Ads export, no mapping needed |
| `05-campaign-level-only.csv` | 63 | No `ad_set` / `ad` columns: they default to `(unassigned)` | `completed`, 63 imported |
| `06-large-30k-rows.csv` | 30,000 | Performance and batching (1.7 MB, 125 campaigns x ads x 60 days) | `completed`, 30,000 imported in a couple of seconds |
| `07-edge-cases.csv` | 8 | Commas and quotes in names, formula injection (`=HYPERLINK(...)`, `+SUM(...)`), zero spend, zero impressions, non-ASCII text, extra whitespace, a very long name | `completed`; **Export CSV** neutralizes the formula cells with a leading apostrophe |
| `08-missing-column.csv` | 5 | A required column (`conversions`) is absent | `400 Missing required columns: conversions` |
| `09-google-ads-export.csv` | 28 | Google Ads layout: two title lines before the header, `Ad group`, quoted thousands separators (`"1,234.50"`), `--` for no data and a `Total` row at the bottom | `completed`: header found on line 3, the Total row is ignored |
| `10-custom-columns.csv` | 28 | A layout nobody recognizes (`When`, `Promo`, `Money out`...) | First `400` with the mapping panel; after you map it once, the mapping is saved and the next file with the same columns imports without it |
| `11-breakdown-by-country.csv` | 85 | Two campaigns x 14 days, each split into 3 rows by `country` (an unmapped extra column), plus one exact copy of a row at the end | `completed_with_errors`: 28 imported, 56 summed into another row of the same campaign and day, 1 rejected as a copy |
| `12-totals-no-date.csv` | 6 | Totals per ad for a whole period, no date column | First `400` with the mapping panel; enter a **Period from / to** (and map nothing else, since the other columns are recognized, only `date` is missing) and each total is spread evenly over the days |

## Column mapping for `10-custom-columns.csv`
| Field | Column in the file |
|---|---|
| date | `When` |
| campaign | `Promo` |
| spend | `Money out` |
| impressions | `Views` |
| clicks | `Taps` |
| conversions | `Sales` |
| revenue | `Income` |

Meta and Google Ads exports are recognized automatically (names such as `Amount spent (USD)`, `Link clicks`, `Results`,
`Cost`, `Conv. value`, `Ad group`; title lines and a `Total` row are handled). Dates must be `YYYY-MM-DD`.

## Using real data
- **Meta Ads Manager:** Reports > Export > CSV, with the breakdown **By day** and the columns above.
- **Google Ads:** Reports > Download > CSV, segmented by **Day**; map `Cost`, `Impressions`, `Clicks`, `Conversions` and `Conv. value`.
- The file needs a **date column** (one row per ad per day) and a **revenue column**. Exports without a date (some public Kaggle
  ad datasets are aggregated per ad) cannot be imported as they are: add a date column first.
