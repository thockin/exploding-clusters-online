# Copyright 2025 Tim Hockin

all:
	@echo "There is no 'all' target defined."

test:
	npm test -- --silent
	for cfg in playwright*.config.ts; do \
		npx playwright test --config=$$cfg --workers 4; \
	done

lint:
	npm run lint

container:
	docker build \
	    -f Dockerfile \
	    -t gcr.io/thockin-joonix-dev/xco:latest \
	    .

push:
	docker push gcr.io/thockin-joonix-dev/xco:latest

