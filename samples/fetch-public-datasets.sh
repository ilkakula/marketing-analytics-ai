#!/bin/sh
# Downloads the public datasets described in public-datasets.md into samples/public/ (ignored by git,
# because their licenses do not clearly allow redistribution).
set -eu
cd "$(dirname "$0")"
mkdir -p public
curl -fsSL -o public/ads_daily.csv \
  https://raw.githubusercontent.com/Lifewitdata/Advertising-Performance-Analytics/HEAD/data/ads_daily.csv
curl -fsSL -o public/KAG_conversion_data.csv \
  https://raw.githubusercontent.com/Esraarashwan/marketing-campaign-analysis/HEAD/data/KAG_conversion_data.csv
# The Kaggle file uses old Mac line endings and has no revenue column. This copy has normal line endings and
# a zero revenue column, only so that the importer's period option can be tried on it.
tr '\r' '\n' < public/KAG_conversion_data.csv | awk 'NF { print (NR == 1 ? $0 ",revenue" : $0 ",0") }' > public/KAG_with_zero_revenue.csv
echo "Downloaded to $(pwd)/public:"; ls -1 public
