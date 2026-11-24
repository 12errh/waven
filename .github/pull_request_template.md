## Summary

<!-- What changed and why. Link the issue when one exists. -->

## Verification

<!-- Commands run and results, plus platforms tested for shell/playback changes. -->

- [ ] `gofmt -l $(git ls-files '*.go')` is empty
- [ ] `go vet -tags gtk3 ./internal/... .` and `go test -tags gtk3 ./internal/... .`
- [ ] `npm --prefix frontend run lint`
- [ ] `npm --prefix frontend run typecheck`
- [ ] `npm --prefix frontend test`
- [ ] `npm --prefix frontend run build`
- [ ] Desktop smoke checklist run if window, tray, playback, or packaging changed

## Notes

<!-- Migration, binding regeneration, screenshots, or follow-up work. -->
