package desktop

import (
	"log"
	"net/http"
)

// SmokeProbe logs the /waven-probe requests emitted by the development smoke
// test. The route exists only when WAVEN_SMOKE=1, so production requests and
// the normal asset server are untouched.
func SmokeProbe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/waven-probe" {
			log.Printf("smoke probe: %s", r.URL.RawQuery)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
