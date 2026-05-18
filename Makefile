RM=rm -f
OUT=home-assistant-tui
VERSION=$(shell sh -c 'version=$$(git describe --long --tags --abbrev=7 2>/dev/null || printf "r%s.%s" "$$(git rev-list --count HEAD)" "$$(git rev-parse --short=7 HEAD)"); printf "%s" "$$version" | sed "s/^v//;s/\([^-]*-g\)/r\1/;s/-/./g"')

build: clean
	mkdir -p dist
	bun build src/index.ts --compile --outfile dist/$(OUT)

install: create_arch
	@echo "Install with: yay -U dist/home-assistant-tui-$(VERSION)-1-$$(uname -m).pkg.tar.zst"

run:
	bun run dev

ci: deps_ci
	bun run ci

test: typecheck

typecheck:
	bun run typecheck

format:
	bun run format

lint:
	bun run format:check

deps:
	bun install

deps_ci:
	bun install --frozen-lockfile

create_arch: clean_dist build
	chmod +x ./.scripts/linux/create-arch.sh
	VERSION=$(VERSION) ./.scripts/linux/create-arch.sh

clean:
	-$(RM) dist/$(OUT) 2>/dev/null

clean_dist:
	-rm -rf build 2>/dev/null
	-rm -rf dist 2>/dev/null

help:
	@echo "Available targets:"
	@echo "  build        Build the TUI binary"
	@echo "  install      Build an Arch package and show the install command"
	@echo "  run          Run the TUI in watch mode"
	@echo "  ci           Run CI checks locally"
	@echo "  test         Run the typecheck"
	@echo "  typecheck    Run TypeScript typechecking"
	@echo "  format       Format source files with Prettier"
	@echo "  lint         Check formatting with Prettier"
	@echo "  deps         Install dependencies"
	@echo "  create_arch  Create an Arch Linux package from the compiled binary"
	@echo "  clean        Remove the compiled binary"
	@echo "  clean_dist   Remove build and dist directories"
