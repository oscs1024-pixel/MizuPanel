package sshops

import "testing"

func TestClientConfigSupportsPasswordAuth(t *testing.T) {
	request := SSHRequest{Host: "192.168.1.10", Port: 22, Username: "root", AuthType: AuthTypePassword, Password: "secret"}

	config, err := ClientConfig(request)
	if err != nil {
		t.Fatalf("ClientConfig: %v", err)
	}
	if config.User != "root" {
		t.Fatalf("user = %q, want root", config.User)
	}
	if len(config.Auth) != 1 {
		t.Fatalf("auth methods = %d, want 1", len(config.Auth))
	}
}

func TestClientConfigRejectsInvalidPrivateKey(t *testing.T) {
	request := SSHRequest{Host: "192.168.1.10", Port: 22, Username: "root", AuthType: AuthTypePrivateKey, PrivateKey: "not-a-key"}

	if _, err := ClientConfig(request); err == nil {
		t.Fatalf("ClientConfig should reject invalid private key")
	}
}
