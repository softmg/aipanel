.PHONY: install dev build start lint typecheck test check clean

install:
	pnpm install

dev:
	pnpm dev

build:
	pnpm build

start:
	pnpm start

lint:
	pnpm lint

typecheck:
	pnpm typecheck

test:
	pnpm test

check: typecheck lint test build

clean:
	rm -rf .next
