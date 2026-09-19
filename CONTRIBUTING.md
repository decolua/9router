# Contributing

## Branch Workflow

- `master` — production / source of truth.
- `uat` — user acceptance testing. Cut from `master` and used to validate changes before release.
- feature branches — cut from `master`, merged back via PR.

### Creating / refreshing the `uat` branch

`uat` is branched from `master`:

```bash
git fetch origin
git checkout -B uat origin/master
git push -u origin uat
```

### Promoting changes to UAT

1. Merge your reviewed feature branch into `master` (via PR).
2. Update `uat` from `master`:

   ```bash
   git checkout uat
   git merge --ff-only origin/master   # or: git checkout -B uat origin/master
   git push origin uat
   ```

3. Deploy `uat` and run acceptance tests.
4. Once accepted, changes are already in `master` and can be released.
