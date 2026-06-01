package filetree

import (
	"encoding/base64"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

const (
	DefaultMaxEntries       = 512
	DefaultMaxEditableBytes = 256 * 1024
	DefaultMaxUploadBytes   = 20 * 1024 * 1024
	codePermissionDenied    = "permission_denied"
	codeNotFound            = "not_found"
	codeFailed              = "failed"
	codeBinaryFile          = "binary_file"
	codeTooLarge            = "too_large"
	codeNotDirectory        = "not_directory"
	codeIsDirectory         = "is_directory"
	codeDirectoryNotEmpty   = "directory_not_empty"
)

func List(path string, maxEntries int) protocol.FileListResponse {
	cleanPath := clean(path)
	entries, err := os.ReadDir(cleanPath)
	if err != nil {
		code, message := normalizeError(err)
		if errors.Is(err, fs.ErrPermission) {
			message = "权限不足：当前 Agent 运行用户无权访问该目录。"
		}
		return protocol.FileListResponse{Type: protocol.MessageTypeFileListResponse, Path: cleanPath, Error: message, Code: code}
	}
	if maxEntries <= 0 {
		maxEntries = DefaultMaxEntries
	}
	sort.Slice(entries, func(i, j int) bool {
		left, right := entries[i], entries[j]
		if left.IsDir() != right.IsDir() {
			return left.IsDir()
		}
		return left.Name() < right.Name()
	})
	response := protocol.FileListResponse{Type: protocol.MessageTypeFileListResponse, Path: cleanPath, Entries: make([]protocol.FileEntry, 0, min(len(entries), maxEntries))}
	for i, entry := range entries {
		if i >= maxEntries {
			response.Truncated = true
			break
		}
		fullPath := filepath.Join(cleanPath, entry.Name())
		info, err := os.Lstat(fullPath)
		if err != nil {
			continue
		}
		item := protocol.FileEntry{Name: entry.Name(), Path: fullPath, Type: entryType(info), Size: info.Size(), Mode: info.Mode().String(), ModifiedAt: info.ModTime().Unix()}
		if info.Mode()&os.ModeSymlink != 0 {
			if target, err := os.Readlink(fullPath); err == nil {
				item.LinkTarget = target
			}
		}
		response.Entries = append(response.Entries, item)
	}
	return response
}

func Read(path string, maxBytes int64) protocol.FileReadResponse {
	cleanPath := clean(path)
	if maxBytes <= 0 {
		maxBytes = DefaultMaxEditableBytes
	}
	info, err := os.Stat(cleanPath)
	if err != nil {
		code, message := normalizeError(err)
		return protocol.FileReadResponse{Type: protocol.MessageTypeFileReadResponse, Path: cleanPath, Error: message, Code: code}
	}
	if info.IsDir() {
		return protocol.FileReadResponse{Type: protocol.MessageTypeFileReadResponse, Path: cleanPath, Error: "目录不可编辑。", Code: codeIsDirectory}
	}
	if !info.Mode().IsRegular() {
		return protocol.FileReadResponse{Type: protocol.MessageTypeFileReadResponse, Path: cleanPath, Error: "特殊文件不可编辑。", Code: codeBinaryFile}
	}
	if info.Size() > maxBytes {
		return protocol.FileReadResponse{Type: protocol.MessageTypeFileReadResponse, Path: cleanPath, Size: info.Size(), Error: "文件过大，暂不支持在线编辑。", Code: codeTooLarge}
	}
	file, err := os.Open(cleanPath)
	if err != nil {
		code, message := normalizeError(err)
		return protocol.FileReadResponse{Type: protocol.MessageTypeFileReadResponse, Path: cleanPath, Error: message, Code: code}
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		code, message := normalizeError(err)
		return protocol.FileReadResponse{Type: protocol.MessageTypeFileReadResponse, Path: cleanPath, Error: message, Code: code}
	}
	if int64(len(content)) > maxBytes {
		return protocol.FileReadResponse{Type: protocol.MessageTypeFileReadResponse, Path: cleanPath, Size: info.Size(), Error: "文件过大，暂不支持在线编辑。", Code: codeTooLarge}
	}
	if binary(content) {
		return protocol.FileReadResponse{Type: protocol.MessageTypeFileReadResponse, Path: cleanPath, Size: info.Size(), Error: "二进制文件不可编辑。", Code: codeBinaryFile}
	}
	return protocol.FileReadResponse{Type: protocol.MessageTypeFileReadResponse, Path: cleanPath, Content: string(content), Editable: true, Size: info.Size(), Mode: info.Mode().String(), ModifiedAt: info.ModTime().Unix()}
}

func Write(path string, content string, maxBytes int64) protocol.FileWriteResponse {
	cleanPath := clean(path)
	if maxBytes <= 0 {
		maxBytes = DefaultMaxEditableBytes
	}
	if int64(len([]byte(content))) > maxBytes {
		return protocol.FileWriteResponse{Type: protocol.MessageTypeFileWriteResponse, Path: cleanPath, Error: "文件过大，暂不支持在线编辑。", Code: codeTooLarge}
	}
	if binary([]byte(content)) {
		return protocol.FileWriteResponse{Type: protocol.MessageTypeFileWriteResponse, Path: cleanPath, Error: "二进制内容不可保存。", Code: codeBinaryFile}
	}
	if errResponse, ok := writeBytes(cleanPath, []byte(content), fs.FileMode(0644)); ok {
		return protocol.FileWriteResponse{Type: protocol.MessageTypeFileWriteResponse, Path: cleanPath, Error: errResponse.message, Code: errResponse.code}
	}
	return protocol.FileWriteResponse{Type: protocol.MessageTypeFileWriteResponse, Path: cleanPath, Saved: true}
}

func Upload(path string, contentBase64 string, maxBytes int64) protocol.FileUploadResponse {
	cleanPath := clean(path)
	if maxBytes <= 0 {
		maxBytes = DefaultMaxUploadBytes
	}
	if int64(base64.StdEncoding.DecodedLen(len(contentBase64))) > maxBytes {
		return protocol.FileUploadResponse{Type: protocol.MessageTypeFileUploadResponse, Path: cleanPath, Error: "文件过大，暂不支持上传。", Code: codeTooLarge}
	}
	content, err := base64.StdEncoding.DecodeString(contentBase64)
	if err != nil {
		return protocol.FileUploadResponse{Type: protocol.MessageTypeFileUploadResponse, Path: cleanPath, Error: "上传内容不是有效的 base64。", Code: codeFailed}
	}
	if int64(len(content)) > maxBytes {
		return protocol.FileUploadResponse{Type: protocol.MessageTypeFileUploadResponse, Path: cleanPath, Error: "文件过大，暂不支持上传。", Code: codeTooLarge}
	}
	if errResponse, ok := writeBytes(cleanPath, content, fs.FileMode(0644)); ok {
		return protocol.FileUploadResponse{Type: protocol.MessageTypeFileUploadResponse, Path: cleanPath, Error: errResponse.message, Code: errResponse.code}
	}
	return protocol.FileUploadResponse{Type: protocol.MessageTypeFileUploadResponse, Path: cleanPath, Uploaded: true, Size: int64(len(content))}
}

func Delete(path string) protocol.FileDeleteResponse {
	cleanPath := clean(path)
	if err := os.Remove(cleanPath); err != nil {
		code, message := normalizeError(err)
		return protocol.FileDeleteResponse{Type: protocol.MessageTypeFileDeleteResponse, Path: cleanPath, Error: message, Code: code}
	}
	return protocol.FileDeleteResponse{Type: protocol.MessageTypeFileDeleteResponse, Path: cleanPath, Deleted: true}
}

type fileOperationError struct {
	code    string
	message string
}

func writeBytes(cleanPath string, content []byte, defaultMode fs.FileMode) (fileOperationError, bool) {
	mode := defaultMode
	if info, err := os.Stat(cleanPath); err == nil {
		if info.IsDir() {
			return fileOperationError{code: codeIsDirectory, message: "目录不可编辑。"}, true
		}
		if !info.Mode().IsRegular() {
			return fileOperationError{code: codeBinaryFile, message: "特殊文件不可编辑。"}, true
		}
		mode = info.Mode().Perm()
	} else if !errors.Is(err, fs.ErrNotExist) {
		code, message := normalizeError(err)
		return fileOperationError{code: code, message: message}, true
	}
	if err := os.WriteFile(cleanPath, content, mode); err != nil {
		code, message := normalizeError(err)
		return fileOperationError{code: code, message: message}, true
	}
	return fileOperationError{}, false
}

func clean(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return string(filepath.Separator)
	}
	return filepath.Clean(path)
}

func entryType(info os.FileInfo) string {
	if info.IsDir() {
		return "directory"
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "symlink"
	}
	return "file"
}

func binary(content []byte) bool {
	if len(content) == 0 {
		return false
	}
	if strings.Contains(string(content), "\x00") {
		return true
	}
	return !utf8.Valid(content)
}

func normalizeError(err error) (string, string) {
	switch {
	case errors.Is(err, fs.ErrPermission):
		return codePermissionDenied, "权限不足：当前 Agent 运行用户无权执行该操作。"
	case errors.Is(err, fs.ErrNotExist):
		return codeNotFound, "路径不存在或已被删除。"
	case strings.Contains(strings.ToLower(err.Error()), "not a directory"):
		return codeNotDirectory, "路径不是目录。"
	case strings.Contains(strings.ToLower(err.Error()), "directory not empty"):
		return codeDirectoryNotEmpty, "目录非空，暂不支持直接删除。"
	default:
		return codeFailed, err.Error()
	}
}
