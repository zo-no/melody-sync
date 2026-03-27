# MelodySync Directional Docs

This folder keeps the current MelodySync product-planning documents inside the repo.

These files are the repo-internal copies of the working docs that also live in the Obsidian project folder:

- `product-description.md` — unified product description for the current iteration cycle
- `product-idea.md` — copy of `产品思路.md`
- `project-plan.md` — copy of `项目规划.md`
- `mvp-implementation-plan.md` — copy of `MVP实现方案.md`
- `prd-work-continuity-mvp.md` — copy of `MelodySync PRD｜工作连续性 MVP.md`
- `task-branch-lifecycle.md` — current shipped implementation note for mainline/branch lifecycle, task bar behavior, task clusters, and minimal verification flow

Use these docs by role:

1. `product-description.md` is the product summary. Use it to re-orient quickly on what MelodySync currently is and what the next iteration is trying to achieve.
2. `prd-work-continuity-mvp.md` is the execution anchor. Use it when deciding what the shipped MVP should actually do.
3. `task-branch-lifecycle.md` is the implementation alignment doc. Use it when checking what the current code already does, how branch status flows work, and which gaps are still real.
4. `mvp-implementation-plan.md` is the scope-cut companion. Use it when checking what the first version must include or explicitly defer.
5. `project-plan.md` is the longer-horizon product roadmap for MelodySync as a sustained project.
6. `product-idea.md` preserves the broader origin thesis and long-range direction.

Sync rule:

- update the repo copy when product decisions land here
- update the Obsidian copy when the planning discussion continues there
- keep `prd-work-continuity-mvp.md` tighter than the other docs; it should stay execution-oriented
