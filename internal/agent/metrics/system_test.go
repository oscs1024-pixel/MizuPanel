package metrics

import (
	"net"
	"testing"
)

func TestUsagePercentReturnsZeroWhenTotalIsZero(t *testing.T) {
	if got := usagePercent(0, 0); got != 0 {
		t.Fatalf("usagePercent = %v, want 0", got)
	}
}

func TestUsagePercentCalculatesPercentage(t *testing.T) {
	if got := usagePercent(1000, 250); got != 25 {
		t.Fatalf("usagePercent = %v, want 25", got)
	}
}

func TestChooseLocalIPPrefersIPv4(t *testing.T) {
	addresses := []net.IP{
		net.ParseIP("2001:db8::8"),
		net.ParseIP("10.0.0.8"),
	}

	if got := chooseLocalIP(addresses); got != "10.0.0.8" {
		t.Fatalf("chooseLocalIP = %q, want IPv4", got)
	}
}

func TestChooseLocalIPFallsBackToIPv6(t *testing.T) {
	addresses := []net.IP{
		net.ParseIP("fe80::1"),
		net.ParseIP("2001:db8::8"),
	}

	if got := chooseLocalIP(addresses); got != "2001:db8::8" {
		t.Fatalf("chooseLocalIP = %q, want global IPv6", got)
	}
}
