package filetree

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListReturnsDirectoriesWithClickablePaths(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "conf.d"), 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "app.conf"), []byte("port=8080\n"), 0644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	response := List(dir, DefaultMaxEntries)

	if response.Error != "" {
		t.Fatalf("List returned error: %s", response.Error)
	}
	if len(response.Entries) != 2 {
		t.Fatalf("entries = %#v", response.Entries)
	}
	byName := map[string]string{}
	byPath := map[string]string{}
	for _, entry := range response.Entries {
		byName[entry.Name] = entry.Type
		byPath[entry.Name] = entry.Path
	}
	if byName["app.conf"] != "file" || byPath["app.conf"] != filepath.Join(dir, "app.conf") {
		t.Fatalf("file entries = %#v", response.Entries)
	}
	if byName["conf.d"] != "directory" || byPath["conf.d"] != filepath.Join(dir, "conf.d") {
		t.Fatalf("directory entries = %#v", response.Entries)
	}
}

func TestListReturnsNotDirectoryForFilePath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "app.conf")
	if err := os.WriteFile(path, []byte("port=8080\n"), 0644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	response := List(path, DefaultMaxEntries)
	if response.Code != "not_directory" {
		t.Fatalf("code = %q, want not_directory; response=%#v", response.Code, response)
	}
}

func TestReadTextFileRejectsBinaryAndLargeFiles(t *testing.T) {
	dir := t.TempDir()
	textPath := filepath.Join(dir, "agent.yaml")
	binaryPath := filepath.Join(dir, "image.bin")
	largePath := filepath.Join(dir, "large.log")
	if err := os.WriteFile(textPath, []byte("enable_terminal: true\n"), 0644); err != nil {
		t.Fatalf("write text: %v", err)
	}
	if err := os.WriteFile(binaryPath, []byte{0x00, 0x01, 0x02}, 0644); err != nil {
		t.Fatalf("write binary: %v", err)
	}
	if err := os.WriteFile(largePath, []byte(strings.Repeat("x", 12)), 0644); err != nil {
		t.Fatalf("write large: %v", err)
	}

	text := Read(textPath, 1024)
	if text.Content != "enable_terminal: true\n" || !text.Editable || text.Error != "" {
		t.Fatalf("text response = %#v", text)
	}
	binary := Read(binaryPath, 1024)
	if binary.Code != "binary_file" || binary.Editable || binary.Content != "" {
		t.Fatalf("binary response = %#v", binary)
	}
	large := Read(largePath, 8)
	if large.Code != "too_large" || large.Editable || large.Content != "" {
		t.Fatalf("large response = %#v", large)
	}
}

func TestReadRejectsSymlinkTargetLargerThanLimit(t *testing.T) {
	dir := t.TempDir()
	largePath := filepath.Join(dir, "large.log")
	linkPath := filepath.Join(dir, "link.log")
	if err := os.WriteFile(largePath, []byte(strings.Repeat("x", 32)), 0644); err != nil {
		t.Fatalf("write large: %v", err)
	}
	if err := os.Symlink("large.log", linkPath); err != nil {
		t.Skipf("symlink unsupported: %v", err)
	}

	response := Read(linkPath, 16)
	if response.Code != "too_large" || response.Editable || response.Content != "" {
		t.Fatalf("symlink large response = %#v", response)
	}
}

func TestUploadWritesBinaryContentAndDeleteRemovesFilesOrEmptyDirectories(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "image.bin")
	content := []byte{0x00, 0x01, 0x02}

	upload := Upload(filePath, base64.StdEncoding.EncodeToString(content), 1024)
	if !upload.Uploaded || upload.Error != "" || upload.Size != int64(len(content)) {
		t.Fatalf("upload response = %#v", upload)
	}
	got, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read uploaded file: %v", err)
	}
	if string(got) != string(content) {
		t.Fatalf("uploaded content = %#v", got)
	}

	deleteFile := Delete(filePath)
	if !deleteFile.Deleted || deleteFile.Error != "" {
		t.Fatalf("delete file response = %#v", deleteFile)
	}
	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Fatalf("deleted file stat err = %v, want not exist", err)
	}

	emptyDir := filepath.Join(dir, "empty")
	if err := os.Mkdir(emptyDir, 0755); err != nil {
		t.Fatalf("mkdir empty: %v", err)
	}
	deleteDir := Delete(emptyDir)
	if !deleteDir.Deleted || deleteDir.Error != "" {
		t.Fatalf("delete empty dir response = %#v", deleteDir)
	}

	nonEmptyDir := filepath.Join(dir, "non-empty")
	if err := os.Mkdir(nonEmptyDir, 0755); err != nil {
		t.Fatalf("mkdir non-empty: %v", err)
	}
	if err := os.WriteFile(filepath.Join(nonEmptyDir, "app.conf"), []byte("x"), 0644); err != nil {
		t.Fatalf("write nested: %v", err)
	}
	nonEmptyResponse := Delete(nonEmptyDir)
	if nonEmptyResponse.Code != "directory_not_empty" || nonEmptyResponse.Deleted {
		t.Fatalf("delete non-empty response = %#v", nonEmptyResponse)
	}
}

func TestWriteTextFileUsesCurrentUserPermissions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.yaml")
	if err := os.WriteFile(path, []byte("old\n"), 0644); err != nil {
		t.Fatalf("write initial: %v", err)
	}

	response := Write(path, "new\n", 1024)
	if !response.Saved || response.Error != "" {
		t.Fatalf("write response = %#v", response)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read saved: %v", err)
	}
	if string(content) != "new\n" {
		t.Fatalf("content = %q", content)
	}

	dirResponse := Write(dir, "nope", 1024)
	if dirResponse.Code != "is_directory" || dirResponse.Saved {
		t.Fatalf("directory write response = %#v", dirResponse)
	}
}
