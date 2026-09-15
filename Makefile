EXT_DIR := extension
DIST_DIR := dist
ZIP := $(DIST_DIR)/cloud-bucket-viewer.zip

.PHONY: help zip clean lint icons

help:
	@echo "make zip    - build $(ZIP) for loading into Chrome"
	@echo "make lint   - syntax-check all extension .js files"
	@echo "make icons  - regenerate extension/icons/*.png"
	@echo "make clean  - remove build output"

zip: lint
	@mkdir -p $(DIST_DIR)
	@rm -f $(ZIP)
	@cd $(EXT_DIR) && zip -qr ../$(ZIP) . -x '.*'
	@echo "Built $(ZIP)"
	@echo "Load it via chrome://extensions -> Load unpacked -> $(EXT_DIR)/"
	@echo "or drag the zip onto chrome://extensions with Developer mode on."

lint:
	@for f in $$(find $(EXT_DIR) -name '*.js'); do \
		node --check "$$f" || exit 1; \
	done
	@python3 -c "import json; json.load(open('$(EXT_DIR)/manifest.json'))"
	@echo "Lint OK"

icons:
	python3 scripts/gen_icons.py

clean:
	rm -rf $(DIST_DIR)
