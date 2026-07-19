.PHONY: api-test benchmark-test mobile-check test

api-test:
	cd services/api && pytest

benchmark-test:
	cd benchmark && pytest

mobile-check:
	cd apps/mobile && npm run typecheck

test: api-test benchmark-test mobile-check
