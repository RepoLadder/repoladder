---
"repoladder": patch
---

Fix the `"use client"` / `"use server"` directive scan hanging on large files that open with a comment and hold many block-comment ends; it now runs in linear time.
