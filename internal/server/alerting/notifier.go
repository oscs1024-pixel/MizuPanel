package alerting

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Notifier sends alert notifications through various channels
type Notifier struct {
	client *http.Client
}

// NewNotifier creates a new notification sender
func NewNotifier() *Notifier {
	return &Notifier{
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// NotificationChannel represents a notification destination
type NotificationChannel struct {
	Type       string
	WebhookURL string
	Secret     string
	Headers    map[string]string
}

// AlertPayload contains information about an alert
type AlertPayload struct {
	RuleName    string    `json:"rule_name"`
	NodeID      string    `json:"node_id"`
	NodeName    string    `json:"node_name"`
	MetricField string    `json:"metric_field"`
	MetricValue float64   `json:"metric_value"`
	Threshold   float64   `json:"threshold"`
	Operator    string    `json:"operator"`
	TriggeredAt time.Time `json:"triggered_at"`
	Status      string    `json:"status"` // "triggered" or "resolved"
}

// Send sends a notification through the specified channel
func (n *Notifier) Send(ctx context.Context, channel NotificationChannel, payload AlertPayload) error {
	switch channel.Type {
	case "webhook":
		return n.sendWebhook(ctx, channel, payload)
	case "dingtalk":
		return n.sendDingTalk(ctx, channel, payload)
	case "feishu":
		return n.sendFeishu(ctx, channel, payload)
	case "wecom":
		return n.sendWeCom(ctx, channel, payload)
	default:
		return fmt.Errorf("unsupported notification channel type: %s", channel.Type)
	}
}

// sendWebhook sends a generic webhook notification
func (n *Notifier) sendWebhook(ctx context.Context, channel NotificationChannel, payload AlertPayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", channel.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	for key, value := range channel.Headers {
		req.Header.Set(key, value)
	}

	resp, err := n.client.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}

	return nil
}

// sendDingTalk sends a notification to DingTalk robot
func (n *Notifier) sendDingTalk(ctx context.Context, channel NotificationChannel, payload AlertPayload) error {
	// Build markdown message
	statusEmoji := "🔴"
	if payload.Status == "resolved" {
		statusEmoji = "✅"
	}

	markdown := fmt.Sprintf(`### %s 告警 %s

- **节点**: %s (%s)
- **指标**: %s
- **当前值**: %.2f
- **阈值**: %s %.2f
- **触发时间**: %s`,
		statusEmoji,
		payload.RuleName,
		payload.NodeName,
		payload.NodeID,
		payload.MetricField,
		payload.MetricValue,
		payload.Operator,
		payload.Threshold,
		payload.TriggeredAt.Format("2006-01-02 15:04:05"),
	)

	dingPayload := map[string]interface{}{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"title": fmt.Sprintf("告警: %s", payload.RuleName),
			"text":  markdown,
		},
	}

	// Add signature if secret is provided
	webhookURL := channel.WebhookURL
	if channel.Secret != "" {
		timestamp := time.Now().UnixMilli()
		sign := n.dingTalkSign(timestamp, channel.Secret)
		// Check if URL already has query parameters
		separator := "?"
		if strings.Contains(webhookURL, "?") {
			separator = "&"
		}
		webhookURL = fmt.Sprintf("%s%stimestamp=%d&sign=%s", channel.WebhookURL, separator, timestamp, sign)
	}

	body, err := json.Marshal(dingPayload)
	if err != nil {
		return fmt.Errorf("marshal dingtalk payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", webhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := n.client.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("dingtalk returned status %d", resp.StatusCode)
	}

	// Check response body for DingTalk-specific errors
	var result struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
		if result.ErrCode != 0 {
			return fmt.Errorf("dingtalk error: %s (code %d)", result.ErrMsg, result.ErrCode)
		}
	}

	return nil
}

// dingTalkSign calculates the signature for DingTalk webhook
func (n *Notifier) dingTalkSign(timestamp int64, secret string) string {
	stringToSign := fmt.Sprintf("%d\n%s", timestamp, secret)
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// sendFeishu sends a notification to Feishu (Lark) robot
func (n *Notifier) sendFeishu(ctx context.Context, channel NotificationChannel, payload AlertPayload) error {
	// Build markdown message
	statusEmoji := "🔴"
	statusText := "告警触发"
	if payload.Status == "resolved" {
		statusEmoji = "✅"
		statusText = "告警解除"
	}

	// Feishu uses card format for rich messages
	content := fmt.Sprintf(`**节点**: %s (%s)
**指标**: %s
**当前值**: %.2f
**阈值**: %s %.2f
**触发时间**: %s`,
		payload.NodeName,
		payload.NodeID,
		payload.MetricField,
		payload.MetricValue,
		payload.Operator,
		payload.Threshold,
		payload.TriggeredAt.Format("2006-01-02 15:04:05"),
	)

	feishuPayload := map[string]interface{}{
		"msg_type": "interactive",
		"card": map[string]interface{}{
			"header": map[string]interface{}{
				"title": map[string]interface{}{
					"tag":     "plain_text",
					"content": fmt.Sprintf("%s %s - %s", statusEmoji, statusText, payload.RuleName),
				},
				"template": func() string {
					if payload.Status == "resolved" {
						return "green"
					}
					return "red"
				}(),
			},
			"elements": []map[string]interface{}{
				{
					"tag":     "markdown",
					"content": content,
				},
			},
		},
	}

	// Add signature if secret is provided
	webhookURL := channel.WebhookURL
	if channel.Secret != "" {
		timestamp := time.Now().Unix()
		sign := n.feishuSign(timestamp, channel.Secret)
		feishuPayload["timestamp"] = fmt.Sprintf("%d", timestamp)
		feishuPayload["sign"] = sign
	}

	body, err := json.Marshal(feishuPayload)
	if err != nil {
		return fmt.Errorf("marshal feishu payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", webhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := n.client.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("feishu returned status %d", resp.StatusCode)
	}

	// Check response body for Feishu-specific errors
	var result struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
		if result.Code != 0 {
			return fmt.Errorf("feishu error: %s (code %d)", result.Msg, result.Code)
		}
	}

	return nil
}

// feishuSign calculates the signature for Feishu webhook
func (n *Notifier) feishuSign(timestamp int64, secret string) string {
	stringToSign := fmt.Sprintf("%d\n%s", timestamp, secret)
	h := hmac.New(sha256.New, []byte(stringToSign))
	h.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// sendWeCom sends a notification to WeCom (企业微信) robot
func (n *Notifier) sendWeCom(ctx context.Context, channel NotificationChannel, payload AlertPayload) error {
	// Build markdown message
	statusEmoji := "🔴"
	statusText := "告警触发"
	if payload.Status == "resolved" {
		statusEmoji = "✅"
		statusText = "告警解除"
	}

	markdown := fmt.Sprintf(`### %s %s - %s

**节点**: %s (%s)
**指标**: %s
**当前值**: %.2f
**阈值**: %s %.2f
**触发时间**: %s`,
		statusEmoji,
		statusText,
		payload.RuleName,
		payload.NodeName,
		payload.NodeID,
		payload.MetricField,
		payload.MetricValue,
		payload.Operator,
		payload.Threshold,
		payload.TriggeredAt.Format("2006-01-02 15:04:05"),
	)

	wecomPayload := map[string]interface{}{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"content": markdown,
		},
	}

	body, err := json.Marshal(wecomPayload)
	if err != nil {
		return fmt.Errorf("marshal wecom payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", channel.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := n.client.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("wecom returned status %d", resp.StatusCode)
	}

	// Check response body for WeCom-specific errors
	var result struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
		if result.ErrCode != 0 {
			return fmt.Errorf("wecom error: %s (code %d)", result.ErrMsg, result.ErrCode)
		}
	}

	return nil
}
