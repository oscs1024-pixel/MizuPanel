package sshops

import (
	"time"

	"golang.org/x/crypto/ssh"
)

func ClientConfig(request SSHRequest) (*ssh.ClientConfig, error) {
	if err := ValidateSSHRequest(&request); err != nil {
		return nil, err
	}
	var auth ssh.AuthMethod
	switch request.AuthType {
	case AuthTypePassword:
		auth = ssh.Password(request.Password)
	case AuthTypePrivateKey:
		var signer ssh.Signer
		var err error
		if request.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(request.PrivateKey), []byte(request.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(request.PrivateKey))
		}
		if err != nil {
			return nil, err
		}
		auth = ssh.PublicKeys(signer)
	}
	return &ssh.ClientConfig{
		User:            request.Username,
		Auth:            []ssh.AuthMethod{auth},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         15 * time.Second,
	}, nil
}
