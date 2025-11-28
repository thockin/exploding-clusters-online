all:
	@echo "There is no 'all' target defined."

test:
	npm test
	for cfg in playwright*.config.ts; do \
		npx playwright test --config=$$cfg --workers 4; \
	done

lint:
	npm run lint
