# How it works

```
/map
  repoladder summary   analyze the repo (files, imports, calls, services, endpoints) and print a digest
  Claude             groups the files into named parts and writes tours → .repoladder/grouping.json
  repoladder build     validate the grouping against the facts, roll edges up to every rung,
                     lay out each rung with D2, write .repoladder/diagram.html
  repoladder serve   (optional) host the page on 127.0.0.1 with the Ask bar
```

`/share-map` publishes a static copy.

Commit `.repoladder/grouping.json` to keep the same boxes across runs and teammates. Ignore the rest of `.repoladder/`.

Everything runs on your machine, and the website only ever reads public repos. Usage stats are off unless you say yes; see [where things run](../PRIVACY.md#where-things-run) in PRIVACY.md.
