.PHONY: build build-web build-server build-agents package prepare-package clean

DIST_DIR := dist
RELEASE_DIR := $(DIST_DIR)/mizupanel
DOWNLOAD_DIR := $(RELEASE_DIR)/downloads
SERVER_BIN := $(RELEASE_DIR)/mizupanel-server
AGENT_LINUX_AMD64 := $(DOWNLOAD_DIR)/mizupanel-agent-linux-amd64
AGENT_LINUX_ARM64 := $(DOWNLOAD_DIR)/mizupanel-agent-linux-arm64

build: package

package: prepare-package
	$(MAKE) build-web
	$(MAKE) build-server
	$(MAKE) build-agents
	cp server.example.yaml $(RELEASE_DIR)/server.example.yaml
	mkdir -p $(RELEASE_DIR)/scripts
	cp scripts/install-agent.sh $(RELEASE_DIR)/scripts/install-agent.sh

prepare-package:
	rm -rf $(RELEASE_DIR)
	mkdir -p $(RELEASE_DIR)

build-web:
	npm --prefix web run build
	rm -rf $(RELEASE_DIR)/web
	mkdir -p $(RELEASE_DIR)/web
	cp -R web/dist/. $(RELEASE_DIR)/web/

build-server:
	mkdir -p $(RELEASE_DIR)
	CGO_ENABLED=1 go build -o $(SERVER_BIN) ./cmd/server

build-agents:
	mkdir -p $(DOWNLOAD_DIR)
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o $(AGENT_LINUX_AMD64) ./cmd/agent
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o $(AGENT_LINUX_ARM64) ./cmd/agent

clean:
	rm -rf $(DIST_DIR)
