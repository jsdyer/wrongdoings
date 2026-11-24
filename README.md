# The Government’s Wrongdoing Files

<!-- coolcode:guide -->
Filter by institution, year or finding category, then read the published case description and corrective response together. The index covers published founded cases and cannot measure all complaints or an institution’s overall prevalence of wrongdoing.
<!-- /coolcode:guide -->

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

<!-- schedule-reliability -->
## Schedule reliability

Public GitHub repositories can have scheduled workflows disabled after 60 days of inactivity. A separate weekly [schedule guard](.github/workflows/schedule-guard.yml) calls GitHub's enable-workflow API for an explicit list of refresh workflows and itself. It can restore workflows disabled for inactivity, preserves manually disabled workflows, and runs independently of collection failures.

This is an interim mitigation, not a scheduling guarantee: GitHub does not document active-workflow renewal as a permanent exemption, and scheduled runs can be delayed or dropped. A scheduler on our own Linux server is the planned independent trigger. The guard does not collect data, create dummy commits, or change source/check timestamps; successful collection and published data freshness still need monitoring.
<!-- /schedule-reliability -->
