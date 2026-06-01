//go:build !linux

package terminal

func Supported() bool {
	return false
}
