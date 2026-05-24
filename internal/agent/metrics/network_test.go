package metrics

import (
	"testing"
	"time"
)

func TestBytesPerSecondCalculatesRateFromElapsedTime(t *testing.T) {
	previous := time.Date(2026, 5, 24, 10, 0, 0, 0, time.UTC)
	current := previous.Add(5 * time.Second)

	if got := bytesPerSecond(100, 600, previous, current); got != 100 {
		t.Fatalf("bytesPerSecond = %d, want 100", got)
	}
}

func TestBytesPerSecondReturnsZeroForInvalidElapsedTime(t *testing.T) {
	now := time.Date(2026, 5, 24, 10, 0, 0, 0, time.UTC)

	if got := bytesPerSecond(100, 600, now, now); got != 0 {
		t.Fatalf("bytesPerSecond = %d, want 0", got)
	}
}
