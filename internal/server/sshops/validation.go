package sshops

import (
	"errors"
	"fmt"
	"strings"
)

type AuthType string

const (
	AuthTypePassword   AuthType = "password"
	AuthTypePrivateKey AuthType = "private_key"
)

type SSHRequest struct {
	Host       string   `json:"host"`
	Port       int      `json:"port"`
	Username   string   `json:"username"`
	AuthType   AuthType `json:"auth_type"`
	Password   string   `json:"password,omitempty"`
	PrivateKey string   `json:"private_key,omitempty"`
	Passphrase string   `json:"passphrase,omitempty"`
}

func ValidateSSHRequest(request *SSHRequest) error {
	request.Host = strings.TrimSpace(request.Host)
	request.Username = strings.TrimSpace(request.Username)
	request.AuthType = AuthType(strings.TrimSpace(string(request.AuthType)))
	if request.Host == "" {
		return errors.New("ssh host is required")
	}
	if request.Port == 0 {
		request.Port = 22
	}
	if request.Port < 1 || request.Port > 65535 {
		return errors.New("ssh port is invalid")
	}
	if request.Username != "root" {
		return errors.New("ssh username must be root")
	}
	switch request.AuthType {
	case AuthTypePassword:
		if request.Password == "" {
			return errors.New("ssh password is required")
		}
	case AuthTypePrivateKey:
		if strings.TrimSpace(request.PrivateKey) == "" {
			return errors.New("ssh private key is required")
		}
	default:
		return fmt.Errorf("unsupported ssh auth_type %q", request.AuthType)
	}
	return nil
}

func SanitizeProgressMessage(message string, secrets []string) string {
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		message = strings.ReplaceAll(message, secret, "[redacted]")
	}
	return message
}
