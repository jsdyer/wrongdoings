# The Government’s Wrongdoing Files

[Open the live explorer](https://coolcode.ca/wrongdoings/)

Search the federal [Acts of Founded Wrongdoing catalogue](https://open.canada.ca/data/en/dataset/6e75f19c-d19d-48aa-984e-609c8d9bc403). Filter by institution, year, or official finding category and open the published case description and response. Search covers the English and French source fields, including recommendations and corrective measures.

The dataset reports published founded cases under the Public Servants Disclosure Protection Act. It does not enumerate every complaint or assess the prevalence of wrongdoing in an institution. Dates are file dates from the source. The app does not add allegations, infer identities, or rank institutions.

## Build and preview

```sh
python3 scripts/build.py
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000/. Use a current browser with Web Worker and gzip decompression support. Python 3.10 or later is needed only to build the site. Set `--csv /path/to/wrongdoing.csv` to rebuild from a previously downloaded government export.

GitHub Actions builds and publishes this site on a daily schedule, app changes, and manual workflow runs. The build downloads the official CSV documented in `dataset.json`. Generated browser files live in the Pages artifact. Download or schema failures stop deployment and retain the last successfully published snapshot.

Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada). Publisher: Treasury Board of Canada Secretariat.
