package sshops

import (
	"strings"
	"testing"
)

func TestValidateSSHRequestRequiresRoot(t *testing.T) {
	request := SSHRequest{Host: "192.168.1.10", Username: "ubuntu", AuthType: AuthTypePassword, Password: "secret"}

	if err := ValidateSSHRequest(&request); err == nil || !strings.Contains(err.Error(), "root") {
		t.Fatalf("ValidateSSHRequest error = %v, want root-only error", err)
	}
}

func TestValidateSSHRequestDefaultsPortAndAcceptsPassword(t *testing.T) {
	request := SSHRequest{Host: "192.168.1.10", Username: "root", AuthType: AuthTypePassword, Password: "secret"}

	if err := ValidateSSHRequest(&request); err != nil {
		t.Fatalf("ValidateSSHRequest: %v", err)
	}
	if request.Port != 22 {
		t.Fatalf("port = %d, want 22", request.Port)
	}
}

func TestValidateSSHRequestAcceptsPrivateKey(t *testing.T) {
	request := SSHRequest{Host: "192.168.1.10", Username: "root", AuthType: AuthTypePrivateKey, PrivateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----"}

	if err := ValidateSSHRequest(&request); err != nil {
		t.Fatalf("ValidateSSHRequest: %v", err)
	}
}

func TestSanitizeProgressMessageRemovesSecrets(t *testing.T) {
	message := SanitizeProgressMessage("run token-abc with password Root@1234", []string{"token-abc", "Root@1234", ""})

	if strings.Contains(message, "token-abc") || strings.Contains(message, "Root@1234") {
		t.Fatalf("sanitized message leaked secret: %q", message)
	}
	if !strings.Contains(message, "[redacted]") {
		t.Fatalf("sanitized message = %q, want redaction marker", message)
	}
}
