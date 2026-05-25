package main

import "testing"

func TestReleasePathsResolveNextToRootExecutable(t *testing.T) {
	paths := releasePaths("/opt/mizupanel/mizupanel-server")

	if paths.StaticDir != "/opt/mizupanel/web" {
		t.Fatalf("StaticDir = %q, want /opt/mizupanel/web", paths.StaticDir)
	}
	if paths.DownloadDir != "/opt/mizupanel/downloads" {
		t.Fatalf("DownloadDir = %q, want /opt/mizupanel/downloads", paths.DownloadDir)
	}
}

func TestRuntimeReleasePathsUseExecutablePath(t *testing.T) {
	paths, err := runtimeReleasePaths(func() (string, error) {
		return "/opt/mizupanel/mizupanel-server", nil
	})
	if err != nil {
		t.Fatalf("runtimeReleasePaths returned error: %v", err)
	}
	if paths.StaticDir != "/opt/mizupanel/web" || paths.DownloadDir != "/opt/mizupanel/downloads" {
		t.Fatalf("paths = %#v", paths)
	}
}
