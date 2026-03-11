# Copyright 2025 Tim Hockin

VERSION ?= $(shell git describe --tags --always --dirty)

all:
	@echo "There is no 'all' target defined."

test:
	npm run build
	npm test -- --silent
	for cfg in playwright*.config.ts; do \
		npx playwright test --config=$$cfg --workers 4; \
	done

lint:
	npm run lint

TAG := $(VERSION)
REGISTRY := ghcr.io/thockin
container:
	docker build \
	    -f Dockerfile \
	    -t $(REGISTRY)/xco:$(TAG) \
	    .

push:
	docker push $(REGISTRY)/xco:$(TAG)

