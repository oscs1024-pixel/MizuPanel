package alerting

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mizupanel/mizupanel/internal/server/store"
)

func TestSendWebhook(t *testing.T) {
	// Mock webhook server
	var receivedPayload AlertPayload
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", r.Header.Get("Content-Type"))
		}
		if err := json.NewDecoder(r.Body).Decode(&receivedPayload); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	notifier := NewNotifier()
	channel := NotificationChannel{
		Type:       "webhook",
		WebhookURL: server.URL,
	}
	payload := AlertPayload{
		RuleName:    "CPU High",
		NodeID:      "node-1",
		NodeName:    "Test Node",
		MetricField: "cpu_usage",
		MetricValue: 85.0,
		Threshold:   80.0,
		Operator:    ">",
		Status:      "triggered",
	}

	err := notifier.Send(context.Background(), channel, payload)
	if err != nil {
		t.Fatalf("send webhook: %v", err)
	}

	if receivedPayload.RuleName != "CPU High" {
		t.Errorf("expected RuleName CPU High, got %s", receivedPayload.RuleName)
	}
	if receivedPayload.MetricValue != 85.0 {
		t.Errorf("expected MetricValue 85.0, got %.2f", receivedPayload.MetricValue)
	}
}

func TestSendWebhookWithHeaders(t *testing.T) {
	// Mock webhook server that checks custom headers
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Custom-Header") != "test-value" {
			t.Errorf("expected X-Custom-Header test-value, got %s", r.Header.Get("X-Custom-Header"))
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	notifier := NewNotifier()
	channel := NotificationChannel{
		Type:       "webhook",
		WebhookURL: server.URL,
		Headers: map[string]string{
			"X-Custom-Header": "test-value",
		},
	}
	payload := AlertPayload{
		RuleName: "Test Rule",
		NodeID:   "node-1",
		Status:   "triggered",
	}

	err := notifier.Send(context.Background(), channel, payload)
	if err != nil {
		t.Fatalf("send webhook: %v", err)
	}
}

func TestSendDingTalk(t *testing.T) {
	// Mock DingTalk server
	var receivedPayload map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&receivedPayload); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"errcode": 0,
			"errmsg":  "ok",
		})
	}))
	defer server.Close()

	notifier := NewNotifier()
	channel := NotificationChannel{
		Type:       "dingtalk",
		WebhookURL: server.URL,
	}
	payload := AlertPayload{
		RuleName:    "Memory High",
		NodeID:      "node-1",
		NodeName:    "Test Node",
		MetricField: "memory_usage",
		MetricValue: 95.0,
		Threshold:   90.0,
		Operator:    ">=",
		Status:      "triggered",
	}

	err := notifier.Send(context.Background(), channel, payload)
	if err != nil {
		t.Fatalf("send dingtalk: %v", err)
	}

	if receivedPayload["msgtype"] != "markdown" {
		t.Errorf("expected msgtype markdown, got %v", receivedPayload["msgtype"])
	}

	markdown, ok := receivedPayload["markdown"].(map[string]interface{})
	if !ok {
		t.Fatal("expected markdown field")
	}
	if markdown["title"] == "" {
		t.Error("expected non-empty title")
	}
}

func TestSendDingTalkWithSecret(t *testing.T) {
	// Mock DingTalk server that checks signature
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check that timestamp and sign query parameters are present
		timestamp := r.URL.Query().Get("timestamp")
		sign := r.URL.Query().Get("sign")
		if timestamp == "" {
			t.Error("expected timestamp query parameter")
		}
		if sign == "" {
			t.Error("expected sign query parameter")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"errcode": 0,
			"errmsg":  "ok",
		})
	}))
	defer server.Close()

	notifier := NewNotifier()
	channel := NotificationChannel{
		Type:       "dingtalk",
		WebhookURL: server.URL,
		Secret:     "test-secret",
	}
	payload := AlertPayload{
		RuleName: "Test Rule",
		NodeID:   "node-1",
		NodeName: "Test Node",
		Status:   "triggered",
	}

	err := notifier.Send(context.Background(), channel, payload)
	if err != nil {
		t.Fatalf("send dingtalk with secret: %v", err)
	}
}

func TestSendUnsupportedChannel(t *testing.T) {
	notifier := NewNotifier()
	channel := NotificationChannel{
		Type:       "email", // Not implemented yet
		WebhookURL: "https://example.com",
	}
	payload := AlertPayload{
		RuleName: "Test Rule",
		NodeID:   "node-1",
		Status:   "triggered",
	}

	err := notifier.Send(context.Background(), channel, payload)
	if err == nil {
		t.Fatal("expected error for unsupported channel type")
	}
}

func TestConvertNotificationChannels(t *testing.T) {
	storeChannels := []store.NotificationChannel{
		{
			Type:       "webhook",
			WebhookURL: "https://example.com/webhook",
			Headers:    map[string]string{"X-Token": "secret"},
		},
		{
			Type:       "dingtalk",
			WebhookURL: "https://oapi.dingtalk.com/robot/send?access_token=xxx",
			Secret:     "dingtalk-secret",
		},
	}

	channels := convertNotificationChannels(storeChannels)
	if len(channels) != 2 {
		t.Fatalf("expected 2 channels, got %d", len(channels))
	}

	if channels[0].Type != "webhook" {
		t.Errorf("expected webhook type, got %s", channels[0].Type)
	}
	if channels[0].Headers["X-Token"] != "secret" {
		t.Error("expected headers to be preserved")
	}

	if channels[1].Type != "dingtalk" {
		t.Errorf("expected dingtalk type, got %s", channels[1].Type)
	}
	if channels[1].Secret != "dingtalk-secret" {
		t.Error("expected secret to be preserved")
	}
}

func convertNotificationChannels(storeChannels []store.NotificationChannel) []NotificationChannel {
	channels := make([]NotificationChannel, len(storeChannels))
	for i, sc := range storeChannels {
		channels[i] = NotificationChannel{
			Type:       sc.Type,
			WebhookURL: sc.WebhookURL,
			Secret:     sc.Secret,
			Headers:    sc.Headers,
		}
	}
	return channels
}
